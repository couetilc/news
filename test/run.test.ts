import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFeedRows, getFeedStates, listItems, updateFeedState } from '../src/ingest/db';
import { parseRss20 } from '../src/ingest/parse/rss20';
import { ingestAll, type IngestDeps } from '../src/ingest/run';
import type { FeedConfig } from '../src/ingest/types';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';

const USER_AGENT = 'news.cuteteal.com aggregator (connor@couetil.com)';
const db = env.NEWS_DB;

const cfFeed: FeedConfig = {
	source: 'cf',
	feed: 'https://cf.test/rss',
	pollIntervalSeconds: 3600,
	parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
};

type Route = () => Response | Promise<Response>;

function fakeFetch(routes: Record<string, Route>) {
	const calls: { url: string; headers: Headers }[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, headers: new Headers(init?.headers) });
		return routes[url]();
	}) as typeof fetch;
	return { fn, calls };
}

const deps = (fetchFn: typeof fetch, now = 1000): IngestDeps => ({
	db,
	fetchFn,
	now: () => now,
});

beforeEach(async () => {
	await db.batch([db.prepare('DELETE FROM items'), db.prepare('DELETE FROM feeds')]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('ingestAll', () => {
	it('polls a due feed, inserts items, and stores the response validators', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const { fn, calls } = fakeFetch({
			'https://cf.test/rss': () =>
				new Response(cloudflareXml, {
					status: 200,
					headers: { ETag: 'v1', 'Last-Modified': 'Thu, 12 Jun 2026 14:00:00 GMT' },
				}),
		});

		await ingestAll(deps(fn), [cfFeed]);

		const rows = await listItems(db, 10);
		expect(rows).toHaveLength(2);

		// A structured (object-form) record lands so Workers Logs can index it.
		expect(logSpy).toHaveBeenCalledWith({
			level: 'info',
			event: 'ingest.poll',
			source: 'cf',
			feed: 'https://cf.test/rss',
			status: 200,
			items: 2,
			inserted: 2,
			outcome: 'ok',
		});

		const [state] = await getFeedStates(db);
		expect(state).toMatchObject({
			etag: 'v1',
			last_modified: 'Thu, 12 Jun 2026 14:00:00 GMT',
			next_poll_at: 1000 + 3600,
			last_status: 200,
			failure_count: 0,
		});

		// A descriptive UA goes out; no conditional headers on a first poll.
		expect(calls[0].headers.get('User-Agent')).toBe(USER_AGENT);
		expect(calls[0].headers.has('If-None-Match')).toBe(false);
	});

	it('skips a feed whose next_poll_at is in the future', async () => {
		await ensureFeedRows(db, [cfFeed]);
		await updateFeedState(db, cfFeed.feed, {
			etag: null,
			lastModified: null,
			nextPollAt: 5000,
			lastStatus: null,
			failureCount: 0,
		});

		const { fn, calls } = fakeFetch({ 'https://cf.test/rss': () => new Response('', { status: 200 }) });
		await ingestAll(deps(fn, 1000), [cfFeed]);

		expect(calls).toEqual([]);
		expect(await listItems(db, 10)).toEqual([]);
	});

	it('sends conditional headers and treats 304 as no-op but reschedules', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		await ensureFeedRows(db, [cfFeed]);
		await updateFeedState(db, cfFeed.feed, {
			etag: 'old-etag',
			lastModified: 'Wed, 10 Jun 2026 12:00:00 GMT',
			nextPollAt: 0,
			lastStatus: 200,
			failureCount: 0,
		});

		const { fn, calls } = fakeFetch({
			'https://cf.test/rss': () => new Response(null, { status: 304 }),
		});
		await ingestAll(deps(fn, 2000), [cfFeed]);

		expect(calls[0].headers.get('If-None-Match')).toBe('old-etag');
		expect(calls[0].headers.get('If-Modified-Since')).toBe('Wed, 10 Jun 2026 12:00:00 GMT');
		expect(await listItems(db, 10)).toEqual([]);

		const [state] = await getFeedStates(db);
		expect(state).toMatchObject({
			etag: 'old-etag',
			last_status: 304,
			next_poll_at: 2000 + 3600,
			failure_count: 0,
		});

		// 304 logs the not_modified outcome (no items/inserted on a no-op).
		expect(logSpy).toHaveBeenCalledWith({
			level: 'info',
			event: 'ingest.poll',
			source: 'cf',
			feed: 'https://cf.test/rss',
			status: 304,
			outcome: 'not_modified',
		});
	});

	it('isolates a failing feed: a non-200 records a failure, other feeds still ingest', async () => {
		const badFeed: FeedConfig = { ...cfFeed, source: 'bad', feed: 'https://bad.test/rss' };
		const { fn } = fakeFetch({
			'https://bad.test/rss': () => new Response('nope', { status: 500 }),
			'https://cf.test/rss': () => new Response(cloudflareXml, { status: 200 }),
		});

		await ingestAll(deps(fn), [badFeed, cfFeed]);

		const states = new Map((await getFeedStates(db)).map((s) => [s.feed, s]));
		expect(states.get('https://bad.test/rss')).toMatchObject({
			failure_count: 1,
			last_status: null, // unchanged from the fresh row; nothing was confirmed
		});
		// The healthy feed was unaffected by the bad one.
		expect(await listItems(db, 10)).toHaveLength(2);
	});

	it('records a failure when fetch itself throws', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { fn } = fakeFetch({
			'https://cf.test/rss': () => {
				throw new Error('network down');
			},
		});

		await ingestAll(deps(fn), [cfFeed]);

		const [state] = await getFeedStates(db);
		expect(state.failure_count).toBe(1);
		expect(await listItems(db, 10)).toEqual([]);

		// The error path emits an object-form record with the stringified error.
		expect(errSpy).toHaveBeenCalledWith({
			level: 'error',
			event: 'ingest.error',
			source: 'cf',
			feed: 'https://cf.test/rss',
			err: 'Error: network down',
		});
	});
});
