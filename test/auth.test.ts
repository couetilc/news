import { describe, expect, it } from 'vitest';
import {
	hashPassword,
	isValidEmail,
	isValidPassword,
	normalizeEmail,
	verifyPassword,
} from '../src/lib/auth';

// Runs in the workers project so crypto.subtle (PBKDF2) runs on real workerd Web
// Crypto. CAVEAT (load-bearing): local workerd does NOT enforce production's
// PBKDF2 iteration cap, so this suite cannot reproduce the prod hang by simply
// hashing — it passed at 210k while every production signup hung. The explicit
// cap invariant below is what actually guards it; a true behavioral repro needs
// an e2e smoke against a real deploy (#77).
//
// Cloudflare Workers HARD-CAPS PBKDF2 at 100,000 iterations (workerd#1346);
// above it crypto.subtle throws "iteration counts above 100000 are not
// supported". Stated independently of src/lib/auth.ts so this is a real check of
// the platform contract, not a tautology against our own constant.
const WORKERS_PBKDF2_MAX_ITERATIONS = 100_000;

// Build a genuine LEGACY single-pass record: "pbkdf2$<iter>$<salt-b64>$<hash-b64>",
// exactly as the pre-#125 code did — ONE PBKDF2 pass of `iter` iterations over
// the UTF-8 (pepper + password) bytes. This is intentionally independent of
// src/lib/auth.ts (it talks to crypto.subtle directly) so it's a real proof that
// the new verify() reads the stored work factor, not a tautology against our own
// derive(). A 1-pass chain in the new code derives identical bytes, so this
// digest is byte-for-byte what an old DB row would hold.
async function makeLegacySinglePassRecord(
	password: string,
	pepper: string,
	iter = 100_000,
): Promise<string> {
	const enc = new TextEncoder();
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const keyMaterial = await crypto.subtle.importKey(
		'raw',
		enc.encode(pepper + password),
		'PBKDF2',
		false,
		['deriveBits'],
	);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter },
		keyMaterial,
		256,
	);
	const toB64 = (bytes: Uint8Array) => {
		let s = '';
		for (const b of bytes) s += String.fromCharCode(b);
		return btoa(s);
	};
	return `pbkdf2$${iter}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

// The work-factor field is now self-describing in two shapes: a chained
// "<perPass>x<passes>" (new, issue #125) or a bare "<iterations>" (legacy,
// single-pass). Return the per-deriveBits-call iteration count and the pass
// count for either shape, so the cap guard can assert on the per-CALL count —
// that, not the effective count, is what the Workers cap limits.
function parseWorkFactor(field: string): { perPass: number; passes: number } {
	if (field.includes('x')) {
		const [perPass, passes] = field.split('x');
		return { perPass: Number(perPass), passes: Number(passes) };
	}
	return { perPass: Number(field), passes: 1 };
}

describe('password hashing', () => {
	it('keeps every PBKDF2 pass within the Cloudflare Workers per-call cap', async () => {
		// RED at the old 210_000 (exceeds the cap → prod signup hangs); GREEN while
		// each deriveBits call is at or below 100_000. With chained PBKDF2 (#125)
		// the EFFECTIVE work factor is perPass × passes, but the platform caps the
		// PER-CALL iteration count — so that is what this regression guard asserts.
		const stored = await hashPassword('correct horse battery');
		const { perPass, passes } = parseWorkFactor(stored.split('$')[1]);
		expect(perPass).toBeLessThanOrEqual(WORKERS_PBKDF2_MAX_ITERATIONS);
		expect(perPass).toBeGreaterThan(0);
		expect(passes).toBeGreaterThan(0);
	});

	it('chains multiple passes for a > single-pass effective work factor (#125)', async () => {
		// New signups must use more than one pass so the effective work factor
		// (perPass × passes) clears a single capped pass and approaches OWASP's
		// 600k SHA-256 target while no single call exceeds the cap.
		const stored = await hashPassword('correct horse battery');
		const field = stored.split('$')[1];
		expect(field).toMatch(/^\d+x\d+$/); // self-describing chained shape
		const { perPass, passes } = parseWorkFactor(field);
		expect(passes).toBeGreaterThan(1);
		expect(perPass * passes).toBeGreaterThanOrEqual(WORKERS_PBKDF2_MAX_ITERATIONS);
	});

	it('produces a self-describing pbkdf2 record and verifies the right password', async () => {
		const stored = await hashPassword('correct horse battery');
		const [algorithm, field, salt, hash] = stored.split('$');
		expect(algorithm).toBe('pbkdf2');
		expect(parseWorkFactor(field).perPass).toBeLessThanOrEqual(
			WORKERS_PBKDF2_MAX_ITERATIONS,
		);
		// salt + hash are non-empty base64 blobs.
		expect(salt.length).toBeGreaterThan(0);
		expect(hash.length).toBeGreaterThan(0);
		expect(await verifyPassword('correct horse battery', stored)).toBe(true);
	});

	it('verifies a legacy single-pass "pbkdf2$<iter>$..." record without a migration', async () => {
		// Backward-compat contract: pre-#125 hashes have a bare integer iterations
		// field (one pass). Build one the way the old code did — a single 100k pass
		// over (pepper + password) — and confirm the new verify path still accepts
		// it. We reproduce the legacy digest via the public API by checking that a
		// hand-constructed legacy-shaped record verifies for the right password and
		// rejects the wrong one. The digest itself is computed by crypto.subtle the
		// same way for a 1-pass chain, so a record this test mints by hashing then
		// rewriting the field to the legacy shape is byte-identical to a true legacy
		// record.
		const legacy = await makeLegacySinglePassRecord('correct horse battery', '');
		expect(legacy.split('$')[1]).toMatch(/^\d+$/); // bare integer, no "x"
		expect(await verifyPassword('correct horse battery', legacy)).toBe(true);
		expect(await verifyPassword('wrong password', legacy)).toBe(false);
	});

	it('new chained hash + verify roundtrips for both right and wrong passwords', async () => {
		const stored = await hashPassword('round-trip-123', 'pepper-X');
		expect(stored.split('$')[1]).toMatch(/^\d+x\d+$/);
		expect(await verifyPassword('round-trip-123', stored, 'pepper-X')).toBe(true);
		expect(await verifyPassword('round-trip-123', stored, 'pepper-Y')).toBe(false);
		expect(await verifyPassword('nope', stored, 'pepper-X')).toBe(false);
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

	it('rejects malformed stored records instead of throwing', async () => {
		// Wrong field count.
		expect(await verifyPassword('x', 'not-a-real-record')).toBe(false);
		expect(await verifyPassword('x', 'pbkdf2$210000$onlythree')).toBe(false);
		// Unknown algorithm.
		expect(await verifyPassword('x', 'bcrypt$210000$c2FsdA==$aGFzaA==')).toBe(false);
		// Non-numeric / non-positive iteration counts (legacy single-pass shape).
		expect(await verifyPassword('x', 'pbkdf2$abc$c2FsdA==$aGFzaA==')).toBe(false);
		expect(await verifyPassword('x', 'pbkdf2$0$c2FsdA==$aGFzaA==')).toBe(false);
		// Chained-shape work factors that are malformed (#125):
		// more than one "x" separator.
		expect(await verifyPassword('x', 'pbkdf2$100000x2x3$c2FsdA==$aGFzaA==')).toBe(false);
		// non-integer / non-positive per-pass count.
		expect(await verifyPassword('x', 'pbkdf2$abcx2$c2FsdA==$aGFzaA==')).toBe(false);
		expect(await verifyPassword('x', 'pbkdf2$0x2$c2FsdA==$aGFzaA==')).toBe(false);
		// non-integer / non-positive pass count.
		expect(await verifyPassword('x', 'pbkdf2$100000xabc$c2FsdA==$aGFzaA==')).toBe(false);
		expect(await verifyPassword('x', 'pbkdf2$100000x0$c2FsdA==$aGFzaA==')).toBe(false);
	});

	it('rejects a record whose stored hash is the wrong length (length short-circuit)', async () => {
		// Well-formed envelope (pbkdf2, valid iterations, valid base64) but the hash
		// decodes to fewer than 32 bytes, so the recomputed 32-byte hash and the
		// stored one differ in length — timingSafeEqual takes its length-mismatch
		// path and returns false without a byte walk.
		const salt = btoa('0123456789abcdef'); // 16 bytes
		const shortHash = btoa('short'); // 5 bytes, not 32
		expect(await verifyPassword('x', `pbkdf2$210000$${salt}$${shortHash}`)).toBe(false);
	});

	it('a tampered hash of the right length still fails the constant-time compare', async () => {
		const stored = await hashPassword('length-edge-case');
		const [algorithm, iterations, salt, hash] = stored.split('$');
		// Flip the first base64 char of the hash to a different valid char,
		// keeping the same length so timingSafeEqual takes its full-walk path
		// rather than the length short-circuit.
		const flipped = (hash[0] === 'A' ? 'B' : 'A') + hash.slice(1);
		const tampered = `${algorithm}$${iterations}$${salt}$${flipped}`;
		expect(await verifyPassword('length-edge-case', tampered)).toBe(false);
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
