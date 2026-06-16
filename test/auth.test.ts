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

describe('password hashing', () => {
	it('uses an iteration count within the Cloudflare Workers PBKDF2 cap', async () => {
		// RED at the old 210_000 (exceeds the cap → prod signup hangs); GREEN once
		// ITERATIONS is at or below 100_000. This is the regression guard for the
		// signup-hang bug.
		const stored = await hashPassword('correct horse battery');
		const iterations = Number(stored.split('$')[1]);
		expect(iterations).toBeLessThanOrEqual(WORKERS_PBKDF2_MAX_ITERATIONS);
		expect(iterations).toBeGreaterThan(0);
	});

	it('produces a self-describing pbkdf2 record and verifies the right password', async () => {
		const stored = await hashPassword('correct horse battery');
		const [algorithm, iterations, salt, hash] = stored.split('$');
		expect(algorithm).toBe('pbkdf2');
		expect(Number(iterations)).toBeLessThanOrEqual(WORKERS_PBKDF2_MAX_ITERATIONS);
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

	it('rejects malformed stored records instead of throwing', async () => {
		// Wrong field count.
		expect(await verifyPassword('x', 'not-a-real-record')).toBe(false);
		expect(await verifyPassword('x', 'pbkdf2$210000$onlythree')).toBe(false);
		// Unknown algorithm.
		expect(await verifyPassword('x', 'bcrypt$210000$c2FsdA==$aGFzaA==')).toBe(false);
		// Non-numeric / non-positive iteration counts.
		expect(await verifyPassword('x', 'pbkdf2$abc$c2FsdA==$aGFzaA==')).toBe(false);
		expect(await verifyPassword('x', 'pbkdf2$0$c2FsdA==$aGFzaA==')).toBe(false);
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
