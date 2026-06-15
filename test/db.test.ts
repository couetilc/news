import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	countItemsByRead,
	distinctSources,
	ensureFeedRows,
	getFeedStates,
	insertItems,
	listItems,
	listItemsByRead,
	setItemRead,
	updateFeedState,
} from '../src/ingest/db';
import type { FeedConfig, ParsedItem } from '../src/ingest/types';

const db = env.NEWS_DB;

const noop = (): never => {
	throw new Error('parse not used in db tests');
};
const feed = (over: Partial<FeedConfig>): FeedConfig => ({
	source: 'src',
	feed: 'https://example.com/feed',
	pollIntervalSeconds: 3600,
	parse: noop,
	...over,
});
const item = (over: Partial<ParsedItem>): ParsedItem => ({
	guid: 'g1',
	url: 'https://example.com/a',
	title: 'Title',
	summary: null,
	contentHtml: null,
	publishedAt: 1000,
	...over,
});

beforeEach(async () => {
	await db.batch([db.prepare('DELETE FROM items'), db.prepare('DELETE FROM feeds')]);
});

describe('ensureFeedRows', () => {
	it('creates a row per configured endpoint, immediately due', async () => {
		await ensureFeedRows(db, [
			feed({ feed: 'https://a.com/rss', source: 'a' }),
			feed({ feed: 'https://b.com/rss', source: 'b' }),
		]);
		const states = await getFeedStates(db);
		expect(states.map((s) => s.feed).sort()).toEqual(['https://a.com/rss', 'https://b.com/rss']);
		expect(states[0].next_poll_at).toBe(0);
		expect(states[0].failure_count).toBe(0);
	});

	it('is idempotent across ticks and preserves existing state', async () => {
		await ensureFeedRows(db, [feed({ feed: 'https://a.com/rss', source: 'a' })]);
		await updateFeedState(db, 'https://a.com/rss', {
			etag: 'abc',
			lastModified: null,
			nextPollAt: 9999,
			lastStatus: 200,
			failureCount: 0,
		});
		await ensureFeedRows(db, [feed({ feed: 'https://a.com/rss', source: 'a' })]);
		const [state] = await getFeedStates(db);
		expect(state.etag).toBe('abc');
		expect(state.next_poll_at).toBe(9999);
	});
});

describe('insertItems', () => {
	it('inserts new items and reports the count', async () => {
		const n = await insertItems(db, 'a', [item({ guid: 'g1' }), item({ guid: 'g2' })], 500);
		expect(n).toBe(2);
	});

	it('deduplicates by (source, guid) on repeat polls', async () => {
		await insertItems(db, 'a', [item({ guid: 'g1' })], 500);
		const second = await insertItems(db, 'a', [item({ guid: 'g1' }), item({ guid: 'g2' })], 600);
		expect(second).toBe(1); // only g2 is new
		const rows = await listItems(db, 10);
		expect(rows).toHaveLength(2);
	});

	it('treats the same guid under different sources as distinct', async () => {
		await insertItems(db, 'a', [item({ guid: 'shared' })], 500);
		const n = await insertItems(db, 'b', [item({ guid: 'shared' })], 500);
		expect(n).toBe(1);
	});

	it('does nothing for an empty batch', async () => {
		expect(await insertItems(db, 'a', [], 500)).toBe(0);
	});
});

describe('updateFeedState', () => {
	it('round-trips the conditional-GET and scheduling fields', async () => {
		await ensureFeedRows(db, [feed({ feed: 'https://a.com/rss', source: 'a' })]);
		await updateFeedState(db, 'https://a.com/rss', {
			etag: 'W/"xyz"',
			lastModified: 'Wed, 10 Jun 2026 12:00:00 GMT',
			nextPollAt: 12345,
			lastStatus: 304,
			failureCount: 2,
		});
		const [state] = await getFeedStates(db);
		expect(state).toMatchObject({
			etag: 'W/"xyz"',
			last_modified: 'Wed, 10 Jun 2026 12:00:00 GMT',
			next_poll_at: 12345,
			last_status: 304,
			failure_count: 2,
		});
	});
});

describe('listItems', () => {
	it('orders by COALESCE(published_at, fetched_at) desc, then id desc, and honors the limit', async () => {
		// A newest by published_at; C has no published_at but a late fetch; B oldest.
		await insertItems(db, 's', [item({ guid: 'A', publishedAt: 2000 })], 100);
		await insertItems(db, 's', [item({ guid: 'B', publishedAt: 1000 })], 100);
		await insertItems(db, 's', [item({ guid: 'C', publishedAt: null })], 1500);
		const rows = await listItems(db, 10);
		expect(rows.map((r) => r.guid)).toEqual(['A', 'C', 'B']);

		const limited = await listItems(db, 2);
		expect(limited.map((r) => r.guid)).toEqual(['A', 'C']);
	});

	it('breaks ties on equal timestamps by newest id first', async () => {
		await insertItems(db, 's', [item({ guid: 'first', publishedAt: 1000 })], 100);
		await insertItems(db, 's', [item({ guid: 'second', publishedAt: 1000 })], 100);
		const rows = await listItems(db, 10);
		expect(rows.map((r) => r.guid)).toEqual(['second', 'first']);
	});

	it('sorts read items after unread, each group still newest-first', async () => {
		// newest, middle, oldest by published_at; mark the newest read so it
		// drops below the still-unread middle and oldest.
		await insertItems(db, 's', [item({ guid: 'newest', publishedAt: 3000 })], 100);
		await insertItems(db, 's', [item({ guid: 'middle', publishedAt: 2000 })], 100);
		await insertItems(db, 's', [item({ guid: 'oldest', publishedAt: 1000 })], 100);
		const [{ id: newestId }] = await listItems(db, 1);
		await setItemRead(db, newestId, 5000);

		const rows = await listItems(db, 10);
		// Unread (middle, oldest) lead newest-first; the read item trails.
		expect(rows.map((r) => r.guid)).toEqual(['middle', 'oldest', 'newest']);
		expect(rows.map((r) => r.read_at)).toEqual([null, null, 5000]);
	});

	it('narrows to a single source when one is given, keeping the order', async () => {
		await insertItems(db, 'a', [item({ guid: 'a-new', publishedAt: 3000 })], 100);
		await insertItems(db, 'b', [item({ guid: 'b-mid', publishedAt: 2000 })], 100);
		await insertItems(db, 'a', [item({ guid: 'a-old', publishedAt: 1000 })], 100);

		const rows = await listItems(db, 10, ['a']);
		expect(rows.map((r) => r.guid)).toEqual(['a-new', 'a-old']);
	});

	it('narrows to several sources via IN (...), still unread-before-read', async () => {
		await insertItems(db, 'a', [item({ guid: 'a1', publishedAt: 3000 })], 100);
		await insertItems(db, 'b', [item({ guid: 'b1', publishedAt: 2500 })], 100);
		await insertItems(db, 'c', [item({ guid: 'c1', publishedAt: 2000 })], 100);
		// Mark a1 read so it trails within the a+b selection.
		const [{ id: a1Id }] = await listItems(db, 1, ['a']);
		await setItemRead(db, a1Id, 9000);

		const rows = await listItems(db, 10, ['a', 'b']);
		// c is excluded; unread b1 leads, read a1 trails.
		expect(rows.map((r) => r.guid)).toEqual(['b1', 'a1']);
		expect(rows.map((r) => r.read_at)).toEqual([null, 9000]);
	});

	it('returns nothing for a present-but-empty selection', async () => {
		await insertItems(db, 'a', [item({ guid: 'a1' })], 100);
		expect(await listItems(db, 10, ['b'])).toEqual([]);
	});

	it('treats an empty source list as no filter (All)', async () => {
		await insertItems(db, 'a', [item({ guid: 'a1' })], 100);
		await insertItems(db, 'b', [item({ guid: 'b1' })], 100);
		const rows = await listItems(db, 10, []);
		expect(rows.map((r) => r.guid).sort()).toEqual(['a1', 'b1']);
	});
});

describe('distinctSources', () => {
	it('returns only the sources actually present, ordered by display name', async () => {
		// Slugs chosen so slug order (cloudflare-blog, ieee-spectrum, apple) differs
		// from display-name order (Apple, Cloudflare Blog, IEEE Spectrum).
		await insertItems(db, 'ieee-spectrum', [item({ guid: 'i1' })], 100);
		await insertItems(db, 'cloudflare-blog', [item({ guid: 'c1' })], 100);
		await insertItems(db, 'apple', [item({ guid: 'p1' })], 100);
		// A duplicate of an existing source must not appear twice.
		await insertItems(db, 'apple', [item({ guid: 'p2' })], 100);

		expect(await distinctSources(db)).toEqual(['apple', 'cloudflare-blog', 'ieee-spectrum']);
	});

	it('returns an empty list when no items have been aggregated', async () => {
		expect(await distinctSources(db)).toEqual([]);
	});

	it('orders an unregistered source by its raw slug fallback name', async () => {
		await insertItems(db, 'zzz-wire', [item({ guid: 'z1' })], 100);
		await insertItems(db, 'apple', [item({ guid: 'p1' })], 100);
		// "Apple" sorts before the fallback name "zzz-wire".
		expect(await distinctSources(db)).toEqual(['apple', 'zzz-wire']);
	});
});

describe('listItemsByRead', () => {
	// Seed N items in one source, alternating unread/read by index parity, with
	// descending published_at so insertion order == display order (newest-first).
	async function seed(n: number, source = 's'): Promise<void> {
		for (let i = 0; i < n; i++) {
			await insertItems(db, source, [item({ guid: `g${i}`, publishedAt: 100000 - i })], 100);
		}
	}

	it('reads only the unread section, newest-first, with LIMIT/OFFSET', async () => {
		await seed(5);
		const page1 = await listItemsByRead(db, { read: false, limit: 2, offset: 0 });
		expect(page1.map((r) => r.guid)).toEqual(['g0', 'g1']);
		expect(page1.every((r) => r.read_at === null)).toBe(true);

		const page2 = await listItemsByRead(db, { read: false, limit: 2, offset: 2 });
		expect(page2.map((r) => r.guid)).toEqual(['g2', 'g3']);

		const page3 = await listItemsByRead(db, { read: false, limit: 2, offset: 4 });
		expect(page3.map((r) => r.guid)).toEqual(['g4']);
	});

	it('reads only the read section once items are marked read', async () => {
		await seed(4);
		// Mark g0 and g2 read.
		const all = await listItems(db, 10);
		for (const r of all) {
			if (r.guid === 'g0' || r.guid === 'g2') await setItemRead(db, r.id, 5000);
		}
		const unread = await listItemsByRead(db, { read: false, limit: 10, offset: 0 });
		expect(unread.map((r) => r.guid)).toEqual(['g1', 'g3']);

		const read = await listItemsByRead(db, { read: true, limit: 10, offset: 0 });
		expect(read.map((r) => r.guid)).toEqual(['g0', 'g2']);
		expect(read.every((r) => r.read_at === 5000)).toBe(true);
	});

	it('breaks ties on equal timestamps by newest id first', async () => {
		await insertItems(db, 's', [item({ guid: 'first', publishedAt: 1000 })], 100);
		await insertItems(db, 's', [item({ guid: 'second', publishedAt: 1000 })], 100);
		const rows = await listItemsByRead(db, { read: false, limit: 10, offset: 0 });
		expect(rows.map((r) => r.guid)).toEqual(['second', 'first']);
	});

	it('applies the source filter to the section window', async () => {
		await insertItems(db, 'a', [item({ guid: 'a1', publishedAt: 3000 })], 100);
		await insertItems(db, 'b', [item({ guid: 'b1', publishedAt: 2000 })], 100);
		await insertItems(db, 'a', [item({ guid: 'a2', publishedAt: 1000 })], 100);

		const rows = await listItemsByRead(db, { read: false, limit: 10, offset: 0, sources: ['a'] });
		expect(rows.map((r) => r.guid)).toEqual(['a1', 'a2']);
	});

	it('defaults to no source filter when sources is omitted', async () => {
		await insertItems(db, 'a', [item({ guid: 'a1' })], 100);
		await insertItems(db, 'b', [item({ guid: 'b1' })], 100);
		const rows = await listItemsByRead(db, { read: false, limit: 10, offset: 0 });
		expect(rows.map((r) => r.guid).sort()).toEqual(['a1', 'b1']);
	});

	it('returns an empty window past the last page', async () => {
		await seed(3);
		expect(await listItemsByRead(db, { read: false, limit: 50, offset: 50 })).toEqual([]);
	});
});

describe('countItemsByRead', () => {
	it('counts each section separately', async () => {
		await insertItems(db, 's', [item({ guid: 'g0', publishedAt: 3000 })], 100);
		await insertItems(db, 's', [item({ guid: 'g1', publishedAt: 2000 })], 100);
		await insertItems(db, 's', [item({ guid: 'g2', publishedAt: 1000 })], 100);
		const [g0] = await listItems(db, 1);
		await setItemRead(db, g0.id, 5000);

		expect(await countItemsByRead(db, { read: false })).toBe(2);
		expect(await countItemsByRead(db, { read: true })).toBe(1);
	});

	it('respects the source filter', async () => {
		await insertItems(db, 'a', [item({ guid: 'a1' }), item({ guid: 'a2' })], 100);
		await insertItems(db, 'b', [item({ guid: 'b1' })], 100);
		expect(await countItemsByRead(db, { read: false, sources: ['a'] })).toBe(2);
		expect(await countItemsByRead(db, { read: false, sources: ['a', 'b'] })).toBe(3);
	});

	it('returns 0 for an empty section', async () => {
		expect(await countItemsByRead(db, { read: true })).toBe(0);
	});
});

describe('setItemRead', () => {
	it('marks an item read and clears it back to unread', async () => {
		await insertItems(db, 's', [item({ guid: 'g1' })], 100);
		const [before] = await listItems(db, 1);
		expect(before.read_at).toBeNull();

		await setItemRead(db, before.id, 1234);
		expect((await listItems(db, 1))[0].read_at).toBe(1234);

		await setItemRead(db, before.id, null);
		expect((await listItems(db, 1))[0].read_at).toBeNull();
	});
});
