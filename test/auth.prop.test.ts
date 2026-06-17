import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/auth-crypto';

// CRYPTO-SHELL property tests for src/lib/auth-crypto.ts (#163, #228). Runs in
// the workers project so the KDF runs on REAL workerd Web Crypto (the same
// runtime as production), matching auth.test.ts — and is OUT of Stryker's
// mutation scope. The pure validator/parser properties live in
// test/auth-validate.prop.test.ts (crypto-free, in scope). A fixed seed makes any
// failure reproducible.
//
// WORK FACTOR WARNING: hashPassword runs 100,000 PBKDF2 iterations per call and
// is SLOW. The crypto-roundtrip properties below therefore use a tiny numRuns and
// short generated passwords.
const SEED = 0x163;

describe('verifyPassword — property (malformed records never throw)', () => {
	it('returns false (never throws) for arbitrary stored-record junk', () => {
		// verifyPassword must FAIL CLOSED on any malformed record (#178): wrong
		// field count, unknown tag, bad cost, invalid base64 (atob throws) — all
		// resolve to false, never an exception that would 500 a login. This
		// exercises the full orchestration (pure parse -> shell decode/derive) on
		// the negative path; the pure parser's totality is asserted directly in
		// test/auth-validate.prop.test.ts.
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
