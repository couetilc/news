import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
	hasMore,
	nextOffset,
	parseOffset,
	parseTab,
} from '../src/lib/pagination';

// Property/fuzz tests for the pagination math (#163). The example-based tests in
// pagination.test.ts pin specific boundaries; these assert the INVARIANTS hold
// across a generated input space the enumerated cases can't reach. Pure
// functions, so they run in the default (workers) pool — see the note in
// test/parse-fuzz.test.ts about fast-check under workerd. A fixed seed makes any
// failure reproducible.
const SEED = 0x163;

describe('parseOffset — property', () => {
	it('always returns a non-negative integer for any string', () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const out = parseOffset(raw);
				expect(Number.isInteger(out)).toBe(true);
				expect(out).toBeGreaterThanOrEqual(0);
			}),
			{ seed: SEED },
		);
	});

	it('round-trips a canonical non-negative integer string (parseOffset(String(n)) === n)', () => {
		fc.assert(
			fc.property(fc.nat(), (n) => {
				// String(n) for a JS number can be exponential for huge values
				// (1e21 → "1e+21"), which isn't all-digits and must NOT round-trip;
				// bound to the safe-integer decimal range so String(n) is digits-only.
				expect(parseOffset(String(n))).toBe(n);
			}),
			{ seed: SEED },
		);
	});

	it('rejects non-digit / negative / fractional / whitespace-junk input to 0', () => {
		// Build inputs that are deliberately NOT a clean digit string: a sign, a
		// decimal point, embedded whitespace, or arbitrary non-digit text. Each must
		// fall back to the start of the list (0).
		const junk = fc.oneof(
			fc.integer({ min: -1_000_000, max: -1 }).map(String), // negative → leading '-'
			fc.float({ min: Math.fround(0.001), max: Math.fround(1000), noInteger: true, noNaN: true }).map(String), // fractional → '.'
			fc.nat({ max: 1000 }).map((n) => `${n} ${n}`), // embedded internal whitespace
			fc.nat({ max: 1000 }).map((n) => `${n}x`), // trailing junk parseInt would tolerate
			fc.string().filter((s) => !/^\d+$/.test(s.trim())), // any non-canonical string
		);
		fc.assert(
			fc.property(junk, (raw) => {
				expect(parseOffset(raw)).toBe(0);
			}),
			{ seed: SEED },
		);
	});

	it('is whitespace-tolerant only around an otherwise-canonical digit string', () => {
		// parseOffset trims, so surrounding (not internal) whitespace round-trips.
		fc.assert(
			fc.property(
				fc.nat(),
				fc.stringMatching(/^[ \t\n\r]*$/),
				fc.stringMatching(/^[ \t\n\r]*$/),
				(n, pre, post) => {
					expect(parseOffset(`${pre}${n}${post}`)).toBe(n);
				},
			),
			{ seed: SEED },
		);
	});
});

describe('parseTab — property', () => {
	it('only ever returns one of the two known tabs', () => {
		fc.assert(
			fc.property(fc.option(fc.string(), { nil: null }), (raw) => {
				const out = parseTab(raw);
				expect(out === 'unread' || out === 'read').toBe(true);
			}),
			{ seed: SEED },
		);
	});

	it("maps exactly 'read' to 'read' and everything else to 'unread'", () => {
		fc.assert(
			fc.property(fc.option(fc.string(), { nil: null }), (raw) => {
				expect(parseTab(raw)).toBe(raw === 'read' ? 'read' : 'unread');
			}),
			{ seed: SEED },
		);
		// Pin the canonical match itself so the property above can't pass vacuously.
		expect(parseTab('read')).toBe('read');
	});
});

describe('hasMore / nextOffset — property', () => {
	// Generators bounded to realistic, non-negative paging values.
	const offset = fc.nat({ max: 100_000 });
	const returned = fc.nat({ max: 1000 });
	const total = fc.nat({ max: 200_000 });

	it('hasMore(o, r, total) ⟺ o + r < total', () => {
		fc.assert(
			fc.property(offset, returned, total, (o, r, t) => {
				expect(hasMore(o, r, t)).toBe(o + r < t);
			}),
			{ seed: SEED },
		);
	});

	it('nextOffset(o, r) === o + r and is never less than the current offset', () => {
		fc.assert(
			fc.property(offset, returned, (o, r) => {
				const next = nextOffset(o, r);
				expect(next).toBe(o + r);
				expect(next).toBeGreaterThanOrEqual(o);
			}),
			{ seed: SEED },
		);
	});

	it('an exhausted window (next offset reached total) reports no more', () => {
		// When a window's next offset lands exactly at or past total, hasMore is
		// false — the invariant that stops a phantom empty fetch (#151).
		fc.assert(
			fc.property(offset, returned, (o, r) => {
				const total = nextOffset(o, r); // exactly exhausted
				expect(hasMore(o, r, total)).toBe(false);
			}),
			{ seed: SEED },
		);
	});
});
