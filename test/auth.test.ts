import { describe, expect, it } from 'vitest';
import {
	hashPassword,
	isValidEmail,
	isValidPassword,
	normalizeEmail,
	verifyPassword,
} from '../src/lib/auth';

// Runs in the workers project so the KDF runs on REAL workerd Web Crypto
// (crypto.subtle PBKDF2) — the same runtime as production. New hashes are
// single-pass PBKDF2 at the 100k Workers cap with a 16-byte salt (issues #125,
// #187; the pepper is the compensating control for the sub-OWASP count). The
// verify path also accepts the legacy chained "<perPass>x<passes>" shape, which
// we no longer write but must keep validating — exercised below with an
// independently-derived record.

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

// Independently derive a PBKDF2 record WITHOUT going through src/lib/auth's
// writer, so the assertions are a real cross-check rather than a tautology
// against the module under test. `passes === 1` reproduces what hashPassword
// writes today; `passes > 1` chains output→next-input to produce the legacy
// chained record the writer no longer emits but verifyPassword still accepts.
async function makePbkdf2Record(
	password: string,
	perPass: number,
	passes: number,
	pepper = '',
): Promise<{ record: string }> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	let input: Uint8Array = encoder.encode(pepper + password);
	let out = input;
	for (let i = 0; i < passes; i++) {
		const keyMaterial = await crypto.subtle.importKey('raw', input as BufferSource, 'PBKDF2', false, [
			'deriveBits',
		]);
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

describe('password hashing (pbkdf2)', () => {
	it('produces a self-describing pbkdf2 record at the 100k cap and verifies the right password', async () => {
		const stored = await hashPassword('correct horse battery');
		const [tag, iterations, salt, hash] = stored.split('$');
		expect(tag).toBe('pbkdf2');
		// Single-pass at the Workers 100k cap; the count travels with the record so
		// it can be raised later without a migration.
		expect(iterations).toBe('100000');
		// salt + hash are non-empty base64 blobs.
		expect(salt.length).toBeGreaterThan(0);
		expect(hash.length).toBeGreaterThan(0);
		expect(await verifyPassword('correct horse battery', stored)).toBe(true);
	});

	it('rejects the wrong password (constant-time compare returns false)', async () => {
		const stored = await hashPassword('correct horse battery');
		expect(await verifyPassword('wrong password', stored)).toBe(false);
	});

	it('salts each hash so equal passwords get distinct records', async () => {
		const a = await hashPassword('same-password-123');
		const b = await hashPassword('same-password-123');
		expect(a).not.toBe(b);
		// Both still verify against their own record.
		expect(await verifyPassword('same-password-123', a)).toBe(true);
		expect(await verifyPassword('same-password-123', b)).toBe(true);
	});

	it('mixes in the pepper: a hash made with one pepper fails to verify under another', async () => {
		const stored = await hashPassword('s3cret-password', 'pepper-A');
		expect(await verifyPassword('s3cret-password', stored, 'pepper-A')).toBe(true);
		expect(await verifyPassword('s3cret-password', stored, 'pepper-B')).toBe(false);
		// And the empty-pepper default is distinct from a set pepper.
		expect(await verifyPassword('s3cret-password', stored)).toBe(false);
	});

	it('a tampered hash of the right length still fails the constant-time compare', async () => {
		const stored = await hashPassword('length-edge-case');
		const [tag, iterations, salt, hash] = stored.split('$');
		// Flip the first base64 char of the hash to a different valid char, keeping
		// the same length so timingSafeEqual takes its full-walk path rather than
		// the length short-circuit.
		const flipped = (hash[0] === 'A' ? 'B' : 'A') + hash.slice(1);
		const tampered = `${tag}$${iterations}$${salt}$${flipped}`;
		expect(await verifyPassword('length-edge-case', tampered)).toBe(false);
	});

	// FAIL CLOSED (#178): a corrupt record can make `atob()` throw on invalid
	// base64 past the cost check; verifyPassword must catch it and verify as failed
	// so one bad row returns invalid-credentials instead of 500ing login.
	it('fails closed on invalid base64 instead of throwing', async () => {
		const salt = toBase64(new Uint8Array(16));
		const hash = toBase64(new Uint8Array(32));
		// Invalid base64 in the salt — atob() raises before derivation.
		await expect(verifyPassword('x', `pbkdf2$100000$not-base64!!!!$${hash}`)).resolves.toBe(false);
		// Invalid base64 in the hash field — same fail-closed result.
		await expect(verifyPassword('x', `pbkdf2$100000$${salt}$not-base64!!!!`)).resolves.toBe(false);
	});
});

describe('pbkdf2 verify: independent cross-check, legacy chained, edge cases', () => {
	it('verifies an independently-derived single-pass record byte-for-byte', async () => {
		const { record } = await makePbkdf2Record('correct horse battery', 100_000, 1);
		expect(record.split('$')[1]).toBe('100000'); // plain iteration count
		expect(await verifyPassword('correct horse battery', record)).toBe(true);
		expect(await verifyPassword('wrong password', record)).toBe(false);
	});

	it('still verifies a legacy CHAINED record (<perPass>x<passes>) byte-for-byte', async () => {
		const { record } = await makePbkdf2Record('correct horse battery', 100_000, 3);
		expect(record.split('$')[1]).toBe('100000x3'); // chained cost notation
		expect(await verifyPassword('correct horse battery', record)).toBe(true);
		expect(await verifyPassword('wrong password', record)).toBe(false);
	});

	it('honors the pepper on chained records too', async () => {
		const { record } = await makePbkdf2Record('s3cret', 100_000, 2, 'pepper-A');
		expect(await verifyPassword('s3cret', record, 'pepper-A')).toBe(true);
		expect(await verifyPassword('s3cret', record, 'pepper-B')).toBe(false);
		expect(await verifyPassword('s3cret', record)).toBe(false);
	});

	it('rejects malformed pbkdf2 cost fields instead of throwing', async () => {
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

	it('takes the length short-circuit when a hash decodes to the wrong length', async () => {
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
		expect(await verifyPassword('x', 'pbkdf2$100000$onlythree')).toBe(false);
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
