import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	isValidEmail,
	isValidPassword,
	MIN_PASSWORD_LENGTH,
	normalizeEmail,
	parsePbkdf2Record,
	PBKDF2_TAG,
} from '../src/lib/auth';

// PURE-CORE property tests for src/lib/auth.ts (#163, #228): the validators and
// the record-envelope parser. Crypto-free — imports only fast-check, vitest, and
// the module — so it runs in plain node and stays in Stryker's mutation scope.
// The slow crypto-roundtrip properties (100k PBKDF2 iters/call) live in
// test/auth.prop.test.ts in the workers pool. A fixed seed makes any failure
// reproducible.
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

describe('parsePbkdf2Record — property (pure, total)', () => {
	it('never throws and returns either null or a well-formed descriptor for arbitrary junk', () => {
		fc.assert(
			fc.property(fc.string(), (stored) => {
				const rec = parsePbkdf2Record(stored);
				if (rec === null) return; // malformed -> null, the common case
				// A non-null result is always a fully-validated descriptor.
				expect(rec.tag).toBe(PBKDF2_TAG);
				expect(Number.isInteger(rec.perPass)).toBe(true);
				expect(rec.perPass).toBeGreaterThan(0);
				expect(Number.isInteger(rec.passes)).toBe(true);
				expect(rec.passes).toBeGreaterThan(0);
				expect(typeof rec.saltB64).toBe('string');
				expect(typeof rec.hashB64).toBe('string');
			}),
			{ seed: SEED },
		);
	});

	it('round-trips a well-formed single-pass record built from positive integers + arbitrary field text', () => {
		// salt/hash fields must avoid '$' (the delimiter); the parser does not
		// decode them, so any non-'$' text round-trips verbatim.
		const field = fc.string().map((s) => s.replace(/\$/g, ''));
		fc.assert(
			fc.property(fc.integer({ min: 1, max: 1_000_000 }), field, field, (cost, salt, hash) => {
				const rec = parsePbkdf2Record(`${PBKDF2_TAG}$${cost}$${salt}$${hash}`);
				expect(rec).toEqual({
					tag: PBKDF2_TAG,
					perPass: cost,
					passes: 1,
					saltB64: salt,
					hashB64: hash,
				});
			}),
			{ seed: SEED },
		);
	});

	it('round-trips a well-formed chained record (<perPass>x<passes>)', () => {
		const field = fc.string().map((s) => s.replace(/\$/g, ''));
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 1_000_000 }),
				fc.integer({ min: 1, max: 100 }),
				field,
				field,
				(perPass, passes, salt, hash) => {
					const rec = parsePbkdf2Record(`${PBKDF2_TAG}$${perPass}x${passes}$${salt}$${hash}`);
					expect(rec).toEqual({ tag: PBKDF2_TAG, perPass, passes, saltB64: salt, hashB64: hash });
				},
			),
			{ seed: SEED },
		);
	});

	it('rejects any non-positive-integer single-pass cost', () => {
		const badCost = fc.oneof(
			fc.integer({ max: 0 }).map(String), // zero / negative
			fc.float({ min: Math.fround(0.01), max: Math.fround(0.99), noNaN: true }).map(String), // fractional
			// NB: 'NaN' -> Number('NaN') is NaN (not an integer) so it's rejected; but
			// '1e3' -> 1000 IS a valid positive integer, so it is NOT in this bad set.
			fc.constantFrom('abc', '', 'NaN'),
		);
		fc.assert(
			fc.property(badCost, (cost) => {
				expect(parsePbkdf2Record(`${PBKDF2_TAG}$${cost}$c2FsdA==$aGFzaA==`)).toBeNull();
			}),
			{ seed: SEED },
		);
	});
});
