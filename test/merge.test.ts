import { describe, expect, it } from 'vitest';
import { keepItems, planItemInserts } from '../src/ingest/merge';
import type { ParsedItem } from '../src/ingest/types';

// Example tests for the pure dedup/merge core (#349): the meaning of
// insertItems' bare `ON CONFLICT DO NOTHING` under the two per-source unique
// keys, (source, guid) and (source, url) (#191). The parity block in
// test/db.test.ts (workers project) proves real D1 resolves each scenario the
// way planItemInserts says; the algebraic invariants live in
// test/merge.prop.test.ts. Plain node — in Stryker's mutation scope.

const item = (over: Partial<ParsedItem> & Pick<ParsedItem, 'guid'>): ParsedItem => ({
	url: `https://example.com/${over.guid}`,
	title: 'Title',
	summary: null,
	contentHtml: null,
	publishedAt: 1000,
	...over,
});

const none = { guids: new Set<string>(), urls: new Set<string>() };

describe('planItemInserts', () => {
	it('inserts a fresh batch wholesale, preserving order', () => {
		const batch = [item({ guid: 'a' }), item({ guid: 'b' })];
		expect(planItemInserts(none, batch)).toEqual({ inserts: batch, skips: [] });
	});

	it('skips an item whose guid matches a stored row', () => {
		const dupe = item({ guid: 'a' });
		const fresh = item({ guid: 'b' });
		expect(
			planItemInserts({ guids: new Set(['a']), urls: new Set() }, [dupe, fresh]),
		).toEqual({ inserts: [fresh], skips: [dupe] });
	});

	it('skips a re-keyed item whose guid drifted but whose url held steady (#191)', () => {
		// The NVIDIA WordPress case: the <guid> flipped from ?p=<id> to the
		// permalink, but the url is the same stored permalink → still a dupe.
		const rekeyed = item({ guid: 'permalink-form', url: 'https://example.com/post' });
		expect(
			planItemInserts({ guids: new Set(['?p=42']), urls: new Set(['https://example.com/post']) }, [
				rekeyed,
			]),
		).toEqual({ inserts: [], skips: [rekeyed] });
	});

	it('an in-batch duplicate loses to the earlier item, exactly like statement order in the D1 batch', () => {
		const first = item({ guid: 'a' });
		const again = item({ guid: 'a', title: 'Different title, same key' });
		expect(planItemInserts(none, [first, again])).toEqual({ inserts: [first], skips: [again] });
	});

	it('PINS the order dependence of a partial collision: the earlier item claims the shared url', () => {
		// Two items sharing a url but not a guid: whichever comes first wins, the
		// other skips — the same resolution a sequential ON CONFLICT batch gives.
		// This is deliberate, documented behavior, not an accident.
		const a = item({ guid: 'g1', url: 'https://example.com/shared' });
		const b = item({ guid: 'g2', url: 'https://example.com/shared' });
		expect(planItemInserts(none, [a, b])).toEqual({ inserts: [a], skips: [b] });
		expect(planItemInserts(none, [b, a])).toEqual({ inserts: [b], skips: [a] });
	});

	it('handles the empty batch and does not mutate the existing key sets', () => {
		const existing = { guids: new Set(['a']), urls: new Set(['https://example.com/a']) };
		expect(planItemInserts(existing, [])).toEqual({ inserts: [], skips: [] });
		planItemInserts(existing, [item({ guid: 'b' })]);
		expect(existing.guids).toEqual(new Set(['a']));
		expect(existing.urls).toEqual(new Set(['https://example.com/a']));
	});
});

describe('keepItems (#321)', () => {
	const items = [item({ guid: 'launch' }), item({ guid: 'rollout' }), item({ guid: 'ga' })];

	it('without a keep predicate, keeps everything (the very same array)', () => {
		expect(keepItems(undefined, items)).toBe(items);
	});

	it('filters by the predicate, preserving order', () => {
		expect(keepItems((it) => it.guid !== 'rollout', items)).toEqual([items[0], items[2]]);
		expect(keepItems(() => false, items)).toEqual([]);
	});
});
