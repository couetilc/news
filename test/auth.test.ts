import { describe, expect, it } from 'vitest';
import {
	hashPassword,
	isValidEmail,
	isValidPassword,
	normalizeEmail,
	verifyPassword,
} from '../src/lib/auth';

// Runs in the workers project so crypto.subtle (PBKDF2) behaves exactly as in
// production. No D1 needed, but living here keeps it on real workerd Web Crypto.
describe('password hashing', () => {
	it('produces a self-describing pbkdf2 record and verifies the right password', async () => {
		const stored = await hashPassword('correct horse battery');
		const [algorithm, iterations, salt, hash] = stored.split('$');
		expect(algorithm).toBe('pbkdf2');
		expect(Number(iterations)).toBeGreaterThanOrEqual(210_000);
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
