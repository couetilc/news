import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	hashPassword,
	isValidEmail,
	isValidPassword,
	MIN_PASSWORD_LENGTH,
	normalizeEmail,
	verifyPassword,
} from '../src/lib/auth';

// Property tests for the auth helpers (#163). Runs in the workers project so the
// KDF runs on REAL workerd Web Crypto (the same runtime as production), matching
// auth.test.ts. A fixed seed makes any failure reproducible.
//
// WORK FACTOR WARNING: hashPassword runs 100,000 PBKDF2 iterations per call and
// is SLOW. The crypto-roundtrip property below therefore uses a tiny numRuns and
// short generated passwords; the pure/cheap helpers use normal run counts.
const SEED = 0x163;

describe('normalizeEmail — property', () => {
	it('is idempotent: normalizeEmail(normalizeEmail(x)) === normalizeEmail(x)', () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const once = normalizeEmail(raw);
				expect(normalizeEmail(once)).toBe(once);
			}),
			{ seed: SEED },
		);
	});

	it('output is already trimmed and lowercased (a fixed point of trim+lowercase)', () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const out = normalizeEmail(raw);
				expect(out).toBe(out.trim());
				expect(out).toBe(out.toLowerCase());
			}),
			{ seed: SEED },
		);
	});
});

describe('isValidPassword — property', () => {
	it('accepts exactly the strings at or above the length floor', () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 50 }), (pw) => {
				expect(isValidPassword(pw)).toBe(pw.length >= MIN_PASSWORD_LENGTH);
			}),
			{ seed: SEED },
		);
	});

	it('accepts any string of at least the minimum length', () => {
		fc.assert(
			fc.property(fc.string({ minLength: MIN_PASSWORD_LENGTH, maxLength: 100 }), (pw) => {
				expect(isValidPassword(pw)).toBe(true);
			}),
			{ seed: SEED },
		);
	});
});

describe('isValidEmail — property', () => {
	it('rejects any candidate containing whitespace (the regex forbids it)', () => {
		// A space, tab, or newline anywhere can never be a valid email under the
		// single broad shape (one @, no spaces, a dot in the domain).
		fc.assert(
			fc.property(
				fc.string(),
				fc.constantFrom(' ', '\t', '\n'),
				fc.string(),
				(a, ws, b) => {
					expect(isValidEmail(`${a}${ws}${b}`)).toBe(false);
				},
			),
			{ seed: SEED },
		);
	});

	it('accepts a well-formed local@domain.tld built from safe parts', () => {
		const part = fc.stringMatching(/^[a-z0-9]+$/).filter((s) => s.length > 0);
		fc.assert(
			fc.property(part, part, part, (local, domain, tld) => {
				expect(isValidEmail(`${local}@${domain}.${tld}`)).toBe(true);
			}),
			{ seed: SEED },
		);
	});

	it('never throws for arbitrary input and returns a boolean', () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				expect(typeof isValidEmail(raw)).toBe('boolean');
			}),
			{ seed: SEED },
		);
	});
});

describe('verifyPassword — property (malformed records never throw)', () => {
	it('returns false (never throws) for arbitrary stored-record junk', () => {
		// verifyPassword must FAIL CLOSED on any malformed record (#178): wrong
		// field count, unknown tag, bad cost, invalid base64 (atob throws) — all
		// resolve to false, never an exception that would 500 a login.
		return fc.assert(
			fc.asyncProperty(fc.string(), fc.string(), async (password, stored) => {
				const ok = await verifyPassword(password, stored, '');
				expect(ok).toBe(false);
			}),
			{ seed: SEED, numRuns: 50 },
		);
	});
});

describe('hashPassword / verifyPassword — roundtrip property (SLOW: 100k PBKDF2 iters/call)', () => {
	it('verifyPassword(pw, hashPassword(pw, pepper), pepper) === true', () => {
		// Small numRuns + short passwords: each hashPassword is 100k PBKDF2
		// iterations, so keep the input space tight or the suite crawls.
		return fc.assert(
			fc.asyncProperty(
				fc.string({ minLength: 1, maxLength: 12 }),
				fc.string({ maxLength: 8 }),
				async (password, pepper) => {
					const record = await hashPassword(password, pepper);
					expect(await verifyPassword(password, record, pepper)).toBe(true);
				},
			),
			{ seed: SEED, numRuns: 8 },
		);
	});

	it('a wrong password or wrong pepper never verifies against a real record', () => {
		// Cross-check the negative side so the positive roundtrip can't pass by
		// always returning true. Distinct password and distinct pepper each fail.
		return fc.assert(
			fc.asyncProperty(
				fc.string({ minLength: 1, maxLength: 12 }),
				async (password) => {
					const record = await hashPassword(password, 'pepper-a');
					expect(await verifyPassword(`${password}x`, record, 'pepper-a')).toBe(false);
					expect(await verifyPassword(password, record, 'pepper-b')).toBe(false);
				},
			),
			{ seed: SEED, numRuns: 5 },
		);
	});
});
