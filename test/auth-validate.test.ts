import { describe, expect, it } from 'vitest';
import {
	isValidEmail,
	isValidPassword,
	MIN_PASSWORD_LENGTH,
	normalizeEmail,
	parsePbkdf2Record,
	PBKDF2_TAG,
} from '../src/lib/auth';

// PURE-CORE unit tests for src/lib/auth.ts (#228): the shared input validators
// and the password-record envelope PARSER. This module has no Web Crypto and no
// I/O, so this spec imports ONLY `vitest` and the module under test — it runs in
// plain node and is therefore in Stryker's mutation scope (vitest.stryker.config
// + stryker.config.json `mutate`). The slow 100k-iteration PBKDF2 derivation and
// the verifyPassword orchestration that builds on this parser live in the crypto
// shell (src/lib/auth-crypto.ts) and are tested in test/auth.test.ts in the
// workers pool.

describe('input validation', () => {
	it('normalizes email (trim + lowercase)', () => {
		expect(normalizeEmail('  Foo@Example.COM ')).toBe('foo@example.com');
	});

	it('normalizeEmail is idempotent on an already-clean value', () => {
		expect(normalizeEmail('a@b.com')).toBe('a@b.com');
		expect(normalizeEmail(normalizeEmail('  MiXeD@Y.Com  '))).toBe('mixed@y.com');
	});

	it('accepts a plausible email and rejects malformed ones', () => {
		expect(isValidEmail('a@b.co')).toBe(true);
		expect(isValidEmail('no-at-sign')).toBe(false);
		expect(isValidEmail('two@@at.com')).toBe(false);
		expect(isValidEmail('no@domain')).toBe(false);
		expect(isValidEmail('spaces in@email.com')).toBe(false);
	});

	it('enforces the minimum password length at the boundary', () => {
		expect(MIN_PASSWORD_LENGTH).toBe(8);
		expect(isValidPassword('1234567')).toBe(false); // 7 — below floor
		expect(isValidPassword('12345678')).toBe(true); // 8 — exactly the floor
		expect(isValidPassword('123456789')).toBe(true); // 9 — above floor
		expect(isValidPassword('short')).toBe(false);
	});
});

describe('parsePbkdf2Record — envelope parsing (pure, total, never throws)', () => {
	it('parses a well-formed single-pass record (passes collapses to 1)', () => {
		const rec = parsePbkdf2Record('pbkdf2$100000$c2FsdA==$aGFzaA==');
		expect(rec).toEqual({
			tag: PBKDF2_TAG,
			perPass: 100000,
			passes: 1,
			saltB64: 'c2FsdA==',
			hashB64: 'aGFzaA==',
		});
	});

	it('parses a chained record, splitting <perPass>x<passes>', () => {
		const rec = parsePbkdf2Record('pbkdf2$100000x3$c2FsdA==$aGFzaA==');
		expect(rec).toEqual({
			tag: PBKDF2_TAG,
			perPass: 100000,
			passes: 3,
			saltB64: 'c2FsdA==',
			hashB64: 'aGFzaA==',
		});
	});

	it('keeps the raw base64 fields verbatim (does NOT decode them)', () => {
		// Deliberately invalid base64: the parser must NOT attempt to decode (that
		// is the shell's fail-closed concern), so it returns the bytes untouched.
		const rec = parsePbkdf2Record('pbkdf2$5$not-base64!!!!$also-not-base64!!!!');
		expect(rec).not.toBeNull();
		expect(rec?.saltB64).toBe('not-base64!!!!');
		expect(rec?.hashB64).toBe('also-not-base64!!!!');
	});

	it('rejects the wrong field count', () => {
		expect(parsePbkdf2Record('not-a-real-record')).toBeNull(); // 1 field
		expect(parsePbkdf2Record('pbkdf2$100000$onlythree')).toBeNull(); // 3 fields
		expect(parsePbkdf2Record('pbkdf2$100000$s$h$extra')).toBeNull(); // 5 fields
	});

	it('rejects an unknown algorithm tag', () => {
		expect(parsePbkdf2Record('bcrypt$10$c2FsdA==$aGFzaA==')).toBeNull();
		expect(parsePbkdf2Record('$100000$c2FsdA==$aGFzaA==')).toBeNull(); // empty tag
	});

	it('rejects malformed single-pass cost fields', () => {
		expect(parsePbkdf2Record('pbkdf2$abc$s$h')).toBeNull(); // non-numeric
		expect(parsePbkdf2Record('pbkdf2$0$s$h')).toBeNull(); // zero (not positive)
		expect(parsePbkdf2Record('pbkdf2$-5$s$h')).toBeNull(); // negative
		expect(parsePbkdf2Record('pbkdf2$1.5$s$h')).toBeNull(); // non-integer
		expect(parsePbkdf2Record('pbkdf2$$s$h')).toBeNull(); // empty -> Number('') is 0
	});

	it('rejects malformed chained cost fields (bad perPass or bad passes)', () => {
		expect(parsePbkdf2Record('pbkdf2$abcx3$s$h')).toBeNull(); // bad perPass
		expect(parsePbkdf2Record('pbkdf2$100000x0$s$h')).toBeNull(); // passes = 0
		expect(parsePbkdf2Record('pbkdf2$100000xyz$s$h')).toBeNull(); // bad passes
		expect(parsePbkdf2Record('pbkdf2$100000x-2$s$h')).toBeNull(); // negative passes
		expect(parsePbkdf2Record('pbkdf2$100000x1.5$s$h')).toBeNull(); // non-integer passes
		expect(parsePbkdf2Record('pbkdf2$0x3$s$h')).toBeNull(); // perPass = 0
	});

	it('accepts a minimal positive single-pass cost', () => {
		const rec = parsePbkdf2Record('pbkdf2$1$s$h');
		expect(rec?.perPass).toBe(1);
		expect(rec?.passes).toBe(1);
	});
});
