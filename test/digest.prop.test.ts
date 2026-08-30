import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { activeSourceFilter, feedReturnTo, orderSourcesByName } from '../src/lib/digest';
import { sourceMeta } from '../src/lib/sources';

// Digest-invariant property tests (#349) over the pure assembly decisions. The
// SQL-side invariants (date-descending order, the read/unread partition, count
// consistency) are pinned against real D1 by test/db.test.ts — the SQL is the
// implementation of those, so they are not re-modeled here. A fixed seed makes
// any failure reproducible (repo convention).
const SEED = 0x163;

const arbSlug = fc.oneof(
	fc.constantFrom('aws', 'cf', 'cisco', 'ti', 'nvidia', 'zzz-unknown'),
	fc.string({ maxLength: 12 }),
);

describe('activeSourceFilter — property', () => {
	it('result ⊆ present, preserves request order, and is idempotent', () => {
		fc.assert(
			fc.property(
				fc.array(arbSlug, { maxLength: 10 }),
				fc.array(arbSlug, { maxLength: 10 }),
				(requested, present) => {
					const active = activeSourceFilter(requested, present);
					const presentSet = new Set(present);
					for (const s of active) expect(presentSet.has(s)).toBe(true);
					// Order-preserving subsequence of the request: filtering the request
					// down to the kept members reproduces `active` exactly.
					expect(requested.filter((s) => active.includes(s))).toEqual(active);
					// Idempotent: re-validating an already-validated filter changes nothing.
					expect(activeSourceFilter(active, present)).toEqual(active);
				},
			),
			{ seed: SEED },
		);
	});

	it('a request entirely within present passes through unchanged', () => {
		fc.assert(
			fc.property(fc.array(arbSlug, { maxLength: 10 }), (present) => {
				expect(activeSourceFilter(present, present)).toEqual(present);
			}),
			{ seed: SEED },
		);
	});
});

describe('orderSourcesByName — property', () => {
	it('is a non-mutating permutation, sorted by display name, and idempotent', () => {
		fc.assert(
			fc.property(fc.array(arbSlug, { maxLength: 10 }), (slugs) => {
				const input = [...slugs];
				const ordered = orderSourcesByName(slugs);
				expect(slugs).toEqual(input); // input untouched
				expect([...ordered].sort()).toEqual([...slugs].sort()); // same multiset
				for (let i = 1; i < ordered.length; i++) {
					// Adjacent display names are in non-descending locale order.
					expect(
						sourceMeta(ordered[i - 1]).name.localeCompare(sourceMeta(ordered[i]).name),
					).toBeLessThanOrEqual(0);
				}
				expect(orderSourcesByName(ordered)).toEqual(ordered);
			}),
			{ seed: SEED },
		);
	});
});

describe('feedReturnTo — property', () => {
	it('round-trips the tab and every source slug through URL parsing, in order', () => {
		fc.assert(
			fc.property(
				fc.constantFrom('unread' as const, 'read' as const),
				fc.array(fc.string({ maxLength: 12 }), { maxLength: 6 }),
				(tab, sources) => {
					const href = feedReturnTo(tab, sources);
					expect(href.startsWith('/?')).toBe(true);
					const params = new URLSearchParams(href.slice(2));
					expect(params.get('tab')).toBe(tab);
					expect(params.getAll('source')).toEqual(sources);
				},
			),
			{ seed: SEED },
		);
	});
});
