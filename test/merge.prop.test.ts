import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { keepItems, planItemInserts, type SourceKeys } from '../src/ingest/merge';
import type { ParsedItem } from '../src/ingest/types';

// Ingest-algebra property tests (#349) against the pure dedup/merge core: the
// invariants the issue names — re-ingesting the same feed is a no-op
// (idempotence), and the order sources are polled in never changes the final
// feed (commutativity, because the dedupe keys are scoped per-source) — plus
// the partition laws planItemInserts must satisfy. A fixed seed makes any
// failure reproducible (repo convention).
const SEED = 0x163;

// Small guid/url pools force real collisions (arbitrary strings would almost
// never collide, leaving the dedupe branches unexplored).
const arbItem: fc.Arbitrary<ParsedItem> = fc.record({
	guid: fc.constantFrom('g1', 'g2', 'g3', 'g4', 'g5'),
	url: fc.constantFrom(
		'https://example.com/1',
		'https://example.com/2',
		'https://example.com/3',
		'https://example.com/4',
	),
	title: fc.string({ maxLength: 20 }),
	summary: fc.option(fc.string({ maxLength: 20 }), { nil: null }),
	contentHtml: fc.constant(null),
	publishedAt: fc.option(fc.nat({ max: 5_000_000_000 }), { nil: null }),
});

const arbBatch = fc.array(arbItem, { maxLength: 12 });

const arbKeys: fc.Arbitrary<SourceKeys> = fc.record({
	guids: fc.uniqueArray(fc.constantFrom('g1', 'g2', 'g3'), { maxLength: 3 }).map((a) => new Set(a)),
	urls: fc
		.uniqueArray(fc.constantFrom('https://example.com/1', 'https://example.com/2'), { maxLength: 2 })
		.map((a) => new Set(a)),
});

// Fold a plan's inserts into the key sets — "what the source occupies after the
// poll commits". Mirrors what the D1 rows would then hold.
function afterInserts(existing: SourceKeys, inserts: ParsedItem[]): SourceKeys {
	return {
		guids: new Set([...existing.guids, ...inserts.map((i) => i.guid)]),
		urls: new Set([...existing.urls, ...inserts.map((i) => i.url)]),
	};
}

// The strictly-increasing positions of `part`'s elements in `whole` (reference
// equality) — proves `part` is an order-preserving subsequence.
function positionsIn(whole: readonly ParsedItem[], part: readonly ParsedItem[]): number[] {
	let from = 0;
	return part.map((p) => {
		const at = whole.indexOf(p, from);
		from = at + 1;
		return at;
	});
}

describe('planItemInserts — partition laws', () => {
	it('inserts and skips are complementary order-preserving subsequences of the batch', () => {
		fc.assert(
			fc.property(arbKeys, arbBatch, (existing, batch) => {
				const { inserts, skips } = planItemInserts(existing, batch);
				expect(inserts.length + skips.length).toBe(batch.length);
				const insertAt = positionsIn(batch, inserts);
				const skipAt = positionsIn(batch, skips);
				// Every element found (no -1), and jointly they tile the whole batch.
				expect([...insertAt, ...skipAt].sort((a, b) => a - b)).toEqual(
					batch.map((_, i) => i),
				);
			}),
			{ seed: SEED },
		);
	});

	it('inserts never collide: unique guids, unique urls, both disjoint from existing', () => {
		fc.assert(
			fc.property(arbKeys, arbBatch, (existing, batch) => {
				const { inserts } = planItemInserts(existing, batch);
				const guids = inserts.map((i) => i.guid);
				const urls = inserts.map((i) => i.url);
				expect(new Set(guids).size).toBe(guids.length);
				expect(new Set(urls).size).toBe(urls.length);
				for (const g of guids) expect(existing.guids.has(g)).toBe(false);
				for (const u of urls) expect(existing.urls.has(u)).toBe(false);
			}),
			{ seed: SEED },
		);
	});

	it('IDEMPOTENCE: re-ingesting the same batch after it committed inserts nothing', () => {
		fc.assert(
			fc.property(arbKeys, arbBatch, (existing, batch) => {
				const first = planItemInserts(existing, batch);
				const committed = afterInserts(existing, first.inserts);
				const second = planItemInserts(committed, batch);
				expect(second.inserts).toEqual([]);
				expect(second.skips).toEqual(batch);
			}),
			{ seed: SEED },
		);
	});

	it('planning twice from the same state is deterministic', () => {
		fc.assert(
			fc.property(arbKeys, arbBatch, (existing, batch) => {
				expect(planItemInserts(existing, batch)).toEqual(planItemInserts(existing, batch));
			}),
			{ seed: SEED },
		);
	});
});

describe('ingest algebra — COMMUTATIVITY across sources', () => {
	// The dedupe keys are (source, guid) / (source, url): each source's plan
	// depends only on that source's own keys, so the order sources are polled in
	// can never change the final feed. Model a tick as per-source polls and
	// assert the committed key sets are identical under any source ordering.
	const arbSources = fc.uniqueArray(fc.constantFrom('aws', 'cf', 'cisco', 'ti'), {
		minLength: 1,
		maxLength: 4,
	});

	it('polling sources in any order commits the same per-source final sets', () => {
		fc.assert(
			fc.property(
				arbSources.chain((sources) =>
					fc.record({
						sources: fc.constant(sources),
						batches: fc.array(arbBatch, {
							minLength: sources.length,
							maxLength: sources.length,
						}),
						order: fc.shuffledSubarray(
							sources.map((_, i) => i),
							{ minLength: sources.length, maxLength: sources.length },
						),
					}),
				),
				({ sources, batches, order }) => {
					const commit = (indexes: number[]): Map<string, SourceKeys> => {
						const state = new Map<string, SourceKeys>(
							sources.map((s) => [s, { guids: new Set(), urls: new Set() }]),
						);
						for (const i of indexes) {
							const source = sources[i];
							const keys = state.get(source)!;
							const plan = planItemInserts(keys, batches[i]);
							state.set(source, afterInserts(keys, plan.inserts));
						}
						return state;
					};

					const inConfigOrder = commit(sources.map((_, i) => i));
					const shuffled = commit(order);
					for (const s of sources) {
						expect([...shuffled.get(s)!.guids].sort()).toEqual(
							[...inConfigOrder.get(s)!.guids].sort(),
						);
						expect([...shuffled.get(s)!.urls].sort()).toEqual(
							[...inConfigOrder.get(s)!.urls].sort(),
						);
					}
				},
			),
			{ seed: SEED },
		);
	});
});

describe('keepItems — property', () => {
	it('is an order-preserving subsequence and exactly the predicate matches', () => {
		fc.assert(
			fc.property(arbBatch, fc.func(fc.boolean()), (batch, predicate) => {
				const keep = (it: ParsedItem) => predicate(it.guid);
				const kept = keepItems(keep, batch);
				expect(kept).toEqual(batch.filter(keep));
				const at = positionsIn(batch, kept);
				expect(at.every((i, k) => i >= 0 && (k === 0 || i > at[k - 1]))).toBe(true);
			}),
			{ seed: SEED },
		);
	});
});
