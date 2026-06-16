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
const item = (over: Partial<ParsedItem>): ParsedItem => {
	const guid = over.guid ?? 'g1';
	return {
		guid,
		// Default url is derived from the guid so distinct-guid items are also
		// distinct under the (source, url) dedup key (#191); pass an explicit url
		// to model a guid that drifted while the url stayed the same.
		url: `https://example.com/${guid}`,
		title: 'Title',
		summary: null,
		contentHtml: null,
		publishedAt: 1000,
		...over,
	};
};

// A stable user id for the single-user read-state tests; the two-user
// independence test below uses its own pair (USER_A / USER_B).
const USER = 1;

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM items'),
		db.prepare('DELETE FROM feeds'),
		db.prepare('DELETE FROM item_reads'),
	]);
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

	it('dedupes a re-keyed item whose guid drifted but url held steady (#191)', async () => {
		// The NVIDIA bug: the same post re-ingested under a new guid — the
		// WordPress `?p=<id>` <guid> one poll, the <link> permalink the next — but
		// the SAME canonical url. (source, guid) saw two keys; (source, url) catches it.
		await insertItems(
			db,
			'nvidia',
			[item({ guid: 'https://blogs.nvidia.com/blog/x/', url: 'https://blogs.nvidia.com/blog/x/' })],
			100,
		);
		const second = await insertItems(
			db,
			'nvidia',
			[item({ guid: 'https://blogs.nvidia.com/?p=94478', url: 'https://blogs.nvidia.com/blog/x/' })],
			200,
		);
		expect(second).toBe(0); // same (source, url) → not new despite the new guid
		const rows = await listItems(db, 10);
		expect(rows).toHaveLength(1);
		expect(rows[0].url).toBe('https://blogs.nvidia.com/blog/x/');
	});

	it('treats the same url under different sources as distinct', async () => {
		// The (source, url) key is per-source, so a genuine cross-source repost at
		// the same url is not collapsed — only within-source guid drift is.
		await insertItems(db, 'a', [item({ guid: 'g1', url: 'https://shared.example/post' })], 500);
		const n = await insertItems(db, 'b', [item({ guid: 'g2', url: 'https://shared.example/post' })], 500);
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

	it('sorts read items after unread by the legacy global column, each group newest-first', async () => {
		// listItems backs the public read-only feed (#49) and still reads the
		// legacy GLOBAL items.read_at column (per-user state moved to item_reads in
		// #70). Per-user setItemRead no longer writes that column, so set it
		// directly here to prove listItems' global ordering still works. (The
		// public page renders everything as unread regardless, so this ordering is
		// vestigial — kept until the column is dropped.)
		await insertItems(db, 's', [item({ guid: 'newest', publishedAt: 3000 })], 100);
		await insertItems(db, 's', [item({ guid: 'middle', publishedAt: 2000 })], 100);
		await insertItems(db, 's', [item({ guid: 'oldest', publishedAt: 1000 })], 100);
		const [{ id: newestId }] = await listItems(db, 1);
		await db.prepare('UPDATE items SET read_at = ? WHERE id = ?').bind(5000, newestId).run();

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
		// Mark a1 read (legacy global column — see the note above) so it trails
		// within the a+b selection.
		const [{ id: a1Id }] = await listItems(db, 1, ['a']);
		await db.prepare('UPDATE items SET read_at = ? WHERE id = ?').bind(9000, a1Id).run();

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
		const page1 = await listItemsByRead(db, { userId: USER, read: false, limit: 2, offset: 0 });
		expect(page1.map((r) => r.guid)).toEqual(['g0', 'g1']);
		expect(page1.every((r) => r.read_at === null)).toBe(true);

		const page2 = await listItemsByRead(db, { userId: USER, read: false, limit: 2, offset: 2 });
		expect(page2.map((r) => r.guid)).toEqual(['g2', 'g3']);

		const page3 = await listItemsByRead(db, { userId: USER, read: false, limit: 2, offset: 4 });
		expect(page3.map((r) => r.guid)).toEqual(['g4']);
	});

	it('reads only the read section once items are marked read', async () => {
		await seed(4);
		// Mark g0 and g2 read for USER.
		const all = await listItems(db, 10);
		for (const r of all) {
			if (r.guid === 'g0' || r.guid === 'g2') await setItemRead(db, USER, r.id, 5000);
		}
		const unread = await listItemsByRead(db, { userId: USER, read: false, limit: 10, offset: 0 });
		expect(unread.map((r) => r.guid)).toEqual(['g1', 'g3']);

		const read = await listItemsByRead(db, { userId: USER, read: true, limit: 10, offset: 0 });
		expect(read.map((r) => r.guid)).toEqual(['g0', 'g2']);
		expect(read.every((r) => r.read_at === 5000)).toBe(true);
	});

	it('breaks ties on equal timestamps by newest id first', async () => {
		await insertItems(db, 's', [item({ guid: 'first', publishedAt: 1000 })], 100);
		await insertItems(db, 's', [item({ guid: 'second', publishedAt: 1000 })], 100);
		const rows = await listItemsByRead(db, { userId: USER, read: false, limit: 10, offset: 0 });
		expect(rows.map((r) => r.guid)).toEqual(['second', 'first']);
	});

	it('applies the source filter to the section window', async () => {
		await insertItems(db, 'a', [item({ guid: 'a1', publishedAt: 3000 })], 100);
		await insertItems(db, 'b', [item({ guid: 'b1', publishedAt: 2000 })], 100);
		await insertItems(db, 'a', [item({ guid: 'a2', publishedAt: 1000 })], 100);

		const rows = await listItemsByRead(db, {
			userId: USER,
			read: false,
			limit: 10,
			offset: 0,
			sources: ['a'],
		});
		expect(rows.map((r) => r.guid)).toEqual(['a1', 'a2']);
	});

	it('defaults to no source filter when sources is omitted', async () => {
		await insertItems(db, 'a', [item({ guid: 'a1' })], 100);
		await insertItems(db, 'b', [item({ guid: 'b1' })], 100);
		const rows = await listItemsByRead(db, { userId: USER, read: false, limit: 10, offset: 0 });
		expect(rows.map((r) => r.guid).sort()).toEqual(['a1', 'b1']);
	});

	it('returns an empty window past the last page', async () => {
		await seed(3);
		expect(
			await listItemsByRead(db, { userId: USER, read: false, limit: 50, offset: 50 }),
		).toEqual([]);
	});
});

describe('countItemsByRead', () => {
	it('counts each section separately', async () => {
		await insertItems(db, 's', [item({ guid: 'g0', publishedAt: 3000 })], 100);
		await insertItems(db, 's', [item({ guid: 'g1', publishedAt: 2000 })], 100);
		await insertItems(db, 's', [item({ guid: 'g2', publishedAt: 1000 })], 100);
		const [g0] = await listItems(db, 1);
		await setItemRead(db, USER, g0.id, 5000);

		expect(await countItemsByRead(db, { userId: USER, read: false })).toBe(2);
		expect(await countItemsByRead(db, { userId: USER, read: true })).toBe(1);
	});

	it('respects the source filter', async () => {
		await insertItems(db, 'a', [item({ guid: 'a1' }), item({ guid: 'a2' })], 100);
		await insertItems(db, 'b', [item({ guid: 'b1' })], 100);
		expect(await countItemsByRead(db, { userId: USER, read: false, sources: ['a'] })).toBe(2);
		expect(await countItemsByRead(db, { userId: USER, read: false, sources: ['a', 'b'] })).toBe(3);
	});

	it('returns 0 for an empty section', async () => {
		expect(await countItemsByRead(db, { userId: USER, read: true })).toBe(0);
	});
});

describe('setItemRead', () => {
	// read_at on an ItemRow is now per-user, so read it back through the per-user
	// section query (item_reads join) rather than the global items column.
	const readAtFor = async (userId: number, id: number): Promise<number | null> => {
		const [hit] = await listItemsByRead(db, { userId, read: true, limit: 10, offset: 0 });
		return hit?.id === id ? hit.read_at : null;
	};

	it('marks an item read and clears it back to unread for one user', async () => {
		await insertItems(db, 's', [item({ guid: 'g1' })], 100);
		const [before] = await listItems(db, 1);
		// Nothing read yet: the read section is empty for USER.
		expect(await listItemsByRead(db, { userId: USER, read: true, limit: 10, offset: 0 })).toEqual(
			[],
		);

		await setItemRead(db, USER, before.id, 1234);
		expect(await readAtFor(USER, before.id)).toBe(1234);

		await setItemRead(db, USER, before.id, null);
		expect(await readAtFor(USER, before.id)).toBeNull();
		// Clearing removed the join row, so the unread section sees it again.
		const unread = await listItemsByRead(db, { userId: USER, read: false, limit: 10, offset: 0 });
		expect(unread.map((r) => r.id)).toEqual([before.id]);
	});

	it('is idempotent: re-marking read overwrites the timestamp, never duplicates', async () => {
		await insertItems(db, 's', [item({ guid: 'g1' })], 100);
		const [{ id }] = await listItems(db, 1);

		await setItemRead(db, USER, id, 1000);
		await setItemRead(db, USER, id, 2000);
		// One row in the read section, carrying the latest timestamp (ON CONFLICT).
		const read = await listItemsByRead(db, { userId: USER, read: true, limit: 10, offset: 0 });
		expect(read.map((r) => r.read_at)).toEqual([2000]);
	});

	// #140: a forged/stale POST for an item that doesn't exist must NOT persist an
	// orphan item_reads row. The mark-read INSERT is sourced from `items WHERE
	// id = ?`, so a nonexistent id selects zero rows and inserts nothing.
	it('inserts no read row when marking a nonexistent item read', async () => {
		const NONEXISTENT = 999999;
		expect(await listItems(db, 100)).toEqual([]); // sanity: no such item

		await setItemRead(db, USER, NONEXISTENT, 5000);

		const orphan = await db
			.prepare('SELECT COUNT(*) AS n FROM item_reads WHERE item_id = ?')
			.bind(NONEXISTENT)
			.first<number>('n');
		expect(orphan).toBe(0);
		expect(await countItemsByRead(db, { userId: USER, read: true })).toBe(0);
	});

	it('a bogus toggle cannot pre-mark a future item that later reuses that id (#140)', async () => {
		// Mark a never-existing id read, then materialize an item AT that id (a
		// later feed item reusing it). Pre-#140 the bogus toggle left an orphan row
		// that would instantly mark the new item read; now it wrote nothing.
		const futureId = 4242;
		await setItemRead(db, USER, futureId, 5000);
		await db
			.prepare('INSERT INTO items (id, source, guid, url, title, fetched_at) VALUES (?, ?, ?, ?, ?, ?)')
			.bind(futureId, 's', 'future', 'https://e.com/f', 'Future', 200)
			.run();

		// The freshly created item reads as unread for USER — no leftover row.
		const read = await listItemsByRead(db, { userId: USER, read: true, limit: 10, offset: 0 });
		expect(read.map((r) => r.id)).not.toContain(futureId);
		const unread = await listItemsByRead(db, { userId: USER, read: false, limit: 50, offset: 0 });
		expect(unread.map((r) => r.id)).toContain(futureId);
	});
});

// The core of issue #70: read state is scoped per-user, so two accounts never
// see each other's reads. Exercised against real local D1 (the workers project).
describe('per-user read state isolation (#70)', () => {
	const USER_A = 1;
	const USER_B = 2;

	it('gives two users wholly independent unread/read splits over the same items', async () => {
		// Three shared items; descending published_at so insertion == display order.
		await insertItems(db, 's', [item({ guid: 'g0', publishedAt: 3000 })], 100);
		await insertItems(db, 's', [item({ guid: 'g1', publishedAt: 2000 })], 100);
		await insertItems(db, 's', [item({ guid: 'g2', publishedAt: 1000 })], 100);
		const ids = Object.fromEntries((await listItems(db, 10)).map((r) => [r.guid, r.id]));

		// A reads g0; B reads g1 and g2.
		await setItemRead(db, USER_A, ids.g0, 5000);
		await setItemRead(db, USER_B, ids.g1, 6000);
		await setItemRead(db, USER_B, ids.g2, 7000);

		// A: g0 read; g1, g2 still unread.
		const aUnread = await listItemsByRead(db, { userId: USER_A, read: false, limit: 10, offset: 0 });
		const aRead = await listItemsByRead(db, { userId: USER_A, read: true, limit: 10, offset: 0 });
		expect(aUnread.map((r) => r.guid)).toEqual(['g1', 'g2']);
		expect(aRead.map((r) => r.guid)).toEqual(['g0']);
		expect(await countItemsByRead(db, { userId: USER_A, read: false })).toBe(2);
		expect(await countItemsByRead(db, { userId: USER_A, read: true })).toBe(1);

		// B: the mirror image — g1, g2 read; g0 still unread.
		const bUnread = await listItemsByRead(db, { userId: USER_B, read: false, limit: 10, offset: 0 });
		const bRead = await listItemsByRead(db, { userId: USER_B, read: true, limit: 10, offset: 0 });
		expect(bUnread.map((r) => r.guid)).toEqual(['g0']);
		expect(bRead.map((r) => r.guid)).toEqual(['g1', 'g2']);
		expect(await countItemsByRead(db, { userId: USER_B, read: false })).toBe(1);
		expect(await countItemsByRead(db, { userId: USER_B, read: true })).toBe(2);
	});

	it("clearing one user's read does not touch the other user's row for the same item", async () => {
		await insertItems(db, 's', [item({ guid: 'shared', publishedAt: 1000 })], 100);
		const [{ id }] = await listItems(db, 10);

		// Both users mark the same item read, then A un-reads it.
		await setItemRead(db, USER_A, id, 5000);
		await setItemRead(db, USER_B, id, 5000);
		await setItemRead(db, USER_A, id, null);

		// A sees it unread again; B's read state is untouched.
		expect(await countItemsByRead(db, { userId: USER_A, read: true })).toBe(0);
		expect(await countItemsByRead(db, { userId: USER_A, read: false })).toBe(1);
		const bRead = await listItemsByRead(db, { userId: USER_B, read: true, limit: 10, offset: 0 });
		expect(bRead.map((r) => r.id)).toEqual([id]);
		expect(bRead[0].read_at).toBe(5000);
	});
});
