import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	ensureFeedRows,
	getFeedStates,
	insertItems,
	listItems,
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
});
