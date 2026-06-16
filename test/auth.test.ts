import { describe, expect, it } from 'vitest';
import {
	hashPassword,
	isValidEmail,
	isValidPassword,
	normalizeEmail,
	verifyPassword,
} from '../src/lib/auth';

// Runs in the workers project so the KDF runs on REAL workerd: crypto.subtle
// (for the legacy PBKDF2 verify path) and @noble/hashes argon2id (pure JS, the
// new scheme) both execute in the same runtime as production. The dedicated
// workerd-compat smoke for @noble/hashes lives in test/noble-workerd-smoke.test.ts.
//
// New hashes use ARGON2ID with params m=19456 KiB, t=3, p=1, 32-byte output,
// 16-byte salt (issue #125; OWASP-aligned, within the Worker CPU/memory budget).
// One argon2id hash costs ~1.6s in this workerd pool, so tests that compute
// hashes get a generous per-test timeout. Legacy pbkdf2 records — both
// single-pass and chained "<perPass>x<passes>" — must still verify byte-for-byte
// (the format is self-describing), and PBKDF2 at 100k is fast enough to skip the
// timeout bump.

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

// Independently compute a legacy PBKDF2 record WITHOUT going through
// src/lib/auth's writer (which no longer emits pbkdf2 — it only verifies it).
// This re-derives the exact bytes auth.ts's legacy verify path expects, so the
// back-compat assertions are a real cross-check, not a tautology against the
// module under test. `passes === 1` produces the historical single-pass record;
// `passes > 1` chains output→next-input to produce the chained record.
async function makeLegacyPbkdf2Record(
	password: string,
	perPass: number,
	passes: number,
	pepper = '',
): Promise<{ record: string }> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	let input: Uint8Array = encoder.encode(pepper + password);
	let out = input;
	for (let i = 0; i < passes; i++) {
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			input as BufferSource,
			'PBKDF2',
			false,
			['deriveBits'],
		);
		const bits = await crypto.subtle.deriveBits(
			{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: perPass },
			keyMaterial,
			256,
		);
		out = new Uint8Array(bits);
		input = out;
	}
	const cost = passes === 1 ? `${perPass}` : `${perPass}x${passes}`;
	return { record: `pbkdf2$${cost}$${toBase64(salt)}$${toBase64(out)}` };
}

describe('password hashing (argon2id)', () => {
	it('produces a self-describing argon2id record and verifies the right password', async () => {
		const stored = await hashPassword('correct horse battery');
		const [tag, params, salt, hash] = stored.split('$');
		expect(tag).toBe('argon2id');
		// Params travel with the record so they can be raised later (no migration).
		expect(params).toBe('m=19456,t=3,p=1');
		// salt + hash are non-empty base64 blobs.
		expect(salt.length).toBeGreaterThan(0);
		expect(hash.length).toBeGreaterThan(0);
		expect(await verifyPassword('correct horse battery', stored)).toBe(true);
	}, 30_000);

	it('rejects the wrong password (constant-time compare returns false)', async () => {
		const stored = await hashPassword('correct horse battery');
		expect(await verifyPassword('wrong password', stored)).toBe(false);
	}, 30_000);

	it('salts each hash so equal passwords get distinct records', async () => {
		const a = await hashPassword('same-password-123');
		const b = await hashPassword('same-password-123');
		expect(a).not.toBe(b);
		// Both still verify against their own record.
		expect(await verifyPassword('same-password-123', a)).toBe(true);
		expect(await verifyPassword('same-password-123', b)).toBe(true);
	}, 30_000);

	it('mixes in the pepper: a hash made with one pepper fails to verify under another', async () => {
		const stored = await hashPassword('s3cret-password', 'pepper-A');
		expect(await verifyPassword('s3cret-password', stored, 'pepper-A')).toBe(true);
		expect(await verifyPassword('s3cret-password', stored, 'pepper-B')).toBe(false);
		// And the empty-pepper default is distinct from a set pepper.
		expect(await verifyPassword('s3cret-password', stored)).toBe(false);
	}, 30_000);

	it('rejects malformed argon2id param fields instead of throwing', async () => {
		const salt = toBase64(new Uint8Array(16));
		const hash = toBase64(new Uint8Array(32));
		// Non-numeric param value.
		expect(await verifyPassword('x', `argon2id$m=abc,t=3,p=1$${salt}$${hash}`)).toBe(false);
		// Non-positive param value.
		expect(await verifyPassword('x', `argon2id$m=0,t=3,p=1$${salt}$${hash}`)).toBe(false);
		// Empty param key (the "=value" case).
		expect(await verifyPassword('x', `argon2id$=19456,t=3,p=1$${salt}$${hash}`)).toBe(false);
		// A pair with no "=" at all → value is undefined.
		expect(await verifyPassword('x', `argon2id$m,t=3,p=1$${salt}$${hash}`)).toBe(false);
		// Missing a required param (no p).
		expect(await verifyPassword('x', `argon2id$m=19456,t=3$${salt}$${hash}`)).toBe(false);
	});

	it('a tampered argon2id hash of the right length still fails the constant-time compare', async () => {
		const stored = await hashPassword('length-edge-case');
		const [tag, params, salt, hash] = stored.split('$');
		// Flip the first base64 char of the hash to a different valid char,
		// keeping the same length so timingSafeEqual takes its full-walk path.
		const flipped = (hash[0] === 'A' ? 'B' : 'A') + hash.slice(1);
		const tampered = `${tag}$${params}$${salt}$${flipped}`;
		expect(await verifyPassword('length-edge-case', tampered)).toBe(false);
	}, 30_000);

	// FAIL CLOSED: past the explicit param checks, the argon2id path can still
	// THROW on a corrupt record — `atob()` on invalid base64, and argon2id() on
	// positive-but-out-of-range params or an invalid dkLen from a too-short
	// decoded hash. verifyPassword must catch these and verify as failed so one
	// bad row returns invalid-credentials instead of 500ing login (issue #178).
	it('fails closed on invalid base64 in an argon2id record instead of throwing', async () => {
		const salt = toBase64(new Uint8Array(16));
		const hash = toBase64(new Uint8Array(32));
		// Invalid base64 in the salt — atob() raises DOMException before derive.
		await expect(
			verifyPassword('x', `argon2id$m=19456,t=3,p=1$not-base64!!!!$${hash}`),
		).resolves.toBe(false);
		// Invalid base64 in the hash field — same fail-closed result.
		await expect(
			verifyPassword('x', `argon2id$m=19456,t=3,p=1$${salt}$not-base64!!!!`),
		).resolves.toBe(false);
	});

	it('fails closed on positive-but-out-of-range argon2id params (m=1) instead of throwing', async () => {
		const salt = toBase64(new Uint8Array(16));
		const hash = toBase64(new Uint8Array(32));
		// m=1 passes the >0 integer check but argon2id() rejects it ("m" must be
		// at least 8*p bytes), which would throw without the fail-closed catch.
		await expect(
			verifyPassword('x', `argon2id$m=1,t=3,p=1$${salt}$${hash}`),
		).resolves.toBe(false);
	}, 30_000);

	it('fails closed on an invalid decoded argon2id hash length (drives a bad dkLen) instead of throwing', async () => {
		const salt = toBase64(new Uint8Array(16));
		// Valid base64 whose hash decodes to too few bytes, so dkLen = hash.length
		// is out of argon2id's allowed range (must be 4..) and argon2id() throws.
		const emptyHash = toBase64(new Uint8Array(0)); // 0 bytes -> dkLen 0
		const oneByteHash = toBase64(new Uint8Array(1)); // 1 byte -> dkLen 1
		await expect(
			verifyPassword('x', `argon2id$m=19456,t=3,p=1$${salt}$${emptyHash}`),
		).resolves.toBe(false);
		await expect(
			verifyPassword('x', `argon2id$m=19456,t=3,p=1$${salt}$${oneByteHash}`),
		).resolves.toBe(false);
	}, 30_000);
});

describe('legacy PBKDF2 back-compat (records still verify, no migration)', () => {
	it('verifies a legacy single-pass pbkdf2 record byte-for-byte', async () => {
		const { record } = await makeLegacyPbkdf2Record('correct horse battery', 100_000, 1);
		expect(record.split('$')[0]).toBe('pbkdf2');
		expect(record.split('$')[1]).toBe('100000'); // plain iteration count
		expect(await verifyPassword('correct horse battery', record)).toBe(true);
		expect(await verifyPassword('wrong password', record)).toBe(false);
	});

	it('verifies a legacy CHAINED pbkdf2 record (<perPass>x<passes>) byte-for-byte', async () => {
		const { record } = await makeLegacyPbkdf2Record('correct horse battery', 100_000, 3);
		expect(record.split('$')[1]).toBe('100000x3'); // chained cost notation
		expect(await verifyPassword('correct horse battery', record)).toBe(true);
		expect(await verifyPassword('wrong password', record)).toBe(false);
	});

	it('honors the pepper on legacy records too', async () => {
		const { record } = await makeLegacyPbkdf2Record('s3cret', 100_000, 2, 'pepper-A');
		expect(await verifyPassword('s3cret', record, 'pepper-A')).toBe(true);
		expect(await verifyPassword('s3cret', record, 'pepper-B')).toBe(false);
		expect(await verifyPassword('s3cret', record)).toBe(false);
	});

	it('rejects malformed legacy pbkdf2 cost fields instead of throwing', async () => {
		const salt = toBase64(new Uint8Array(16));
		const hash = toBase64(new Uint8Array(32));
		// Non-numeric / non-positive single-pass counts.
		expect(await verifyPassword('x', `pbkdf2$abc$${salt}$${hash}`)).toBe(false);
		expect(await verifyPassword('x', `pbkdf2$0$${salt}$${hash}`)).toBe(false);
		// Chained notation with a bad perPass or a bad passes count.
		expect(await verifyPassword('x', `pbkdf2$abcx3$${salt}$${hash}`)).toBe(false);
		expect(await verifyPassword('x', `pbkdf2$100000x0$${salt}$${hash}`)).toBe(false);
		expect(await verifyPassword('x', `pbkdf2$100000xyz$${salt}$${hash}`)).toBe(false);
	});

	it('takes the length short-circuit when a legacy hash decodes to the wrong length', async () => {
		// Well-formed envelope (valid cost + base64) but the hash decodes to fewer
		// than 32 bytes, so timingSafeEqual hits its length-mismatch path.
		const salt = toBase64(encoder.encode('0123456789abcdef')); // 16 bytes
		const shortHash = toBase64(encoder.encode('short')); // 5 bytes, not 32
		expect(await verifyPassword('x', `pbkdf2$100000$${salt}$${shortHash}`)).toBe(false);
	});
});

describe('record dispatch / malformed records', () => {
	it('rejects records with the wrong field count', async () => {
		expect(await verifyPassword('x', 'not-a-real-record')).toBe(false);
		expect(await verifyPassword('x', 'argon2id$m=19456,t=3,p=1$onlythree')).toBe(false);
	});

	it('rejects an unknown algorithm tag', async () => {
		expect(await verifyPassword('x', 'bcrypt$10$c2FsdA==$aGFzaA==')).toBe(false);
	});
});

describe('input validation', () => {
	it('normalizes email (trim + lowercase)', () => {
		expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
	});

	it('accepts a plausible email and rejects malformed ones', () => {
		expect(isValidEmail('a@b.co')).toBe(true);
		expect(isValidEmail('no-at-sign')).toBe(false);
		expect(isValidEmail('two@@at.com')).toBe(false);
		expect(isValidEmail('no@domain')).toBe(false);
		expect(isValidEmail('spaces in@email.com')).toBe(false);
	});

	it('enforces the minimum password length', () => {
		expect(isValidPassword('12345678')).toBe(true);
		expect(isValidPassword('short')).toBe(false);
	});
});
