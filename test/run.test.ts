import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFeedRows, getFeedStates, listItems, updateFeedState } from '../src/ingest/db';
import { parseRss20 } from '../src/ingest/parse/rss20';
import { parseAwsWhatsNew } from '../src/ingest/parse/aws-whats-new';
import { parseSecEdgar } from '../src/ingest/parse/sec-edgar';
import { ingestAll, type IngestDeps } from '../src/ingest/run';
import type { FeedConfig } from '../src/ingest/types';
import { countRss20 } from '../src/ingest/parse/count';
import gravitonJson from './fixtures/aws-graviton.json?raw';
import nitroJson from './fixtures/aws-nitro.json?raw';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';
import ciscoXml from './fixtures/cisco.xml?raw';
import ciscoEdgarJson from './fixtures/cisco-sec-edgar.json?raw';
import driftZeroXml from './fixtures/drift-zero-parsed.xml?raw';
import driftMissingFieldsXml from './fixtures/drift-missing-fields.xml?raw';

const USER_AGENT = 'news.cuteteal.com aggregator (connor@couetil.com)';
const db = env.NEWS_DB;

const cfFeed: FeedConfig = {
	source: 'cf',
	feed: 'https://cf.test/rss',
	pollIntervalSeconds: 3600,
	parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
	countRaw: countRss20,
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

	it('dedupes AWS items shared across two term queries (same source, same id → one row)', async () => {
		// #26: graviton and nitro queries are separate FeedConfigs sharing
		// source 'aws'. Both fixtures contain the id launch-shared-nitro-graviton.
		// run.ts polls each feed and insertItems' (source, guid) ON CONFLICT
		// collapses the overlap — no bespoke cross-query dedupe code.
		const gravitonFeed: FeedConfig = {
			source: 'aws',
			feed: 'https://aws.test/search?q=graviton',
			pollIntervalSeconds: 21600,
			parse: parseAwsWhatsNew,
		};
		const nitroFeed: FeedConfig = { ...gravitonFeed, feed: 'https://aws.test/search?q=nitro' };

		const { fn } = fakeFetch({
			'https://aws.test/search?q=graviton': () => new Response(gravitonJson, { status: 200 }),
			'https://aws.test/search?q=nitro': () => new Response(nitroJson, { status: 200 }),
		});

		await ingestAll(deps(fn), [gravitonFeed, nitroFeed]);

		const rows = await listItems(db, 50);
		// graviton: 2 items (m9g + shared); nitro: 2 items (shared + enclaves).
		// The shared id appears once → 3 distinct rows.
		expect(rows).toHaveLength(3);
		const guids = rows.map((r) => r.guid).sort();
		expect(guids).toEqual([
			'whats-new-v2#launch-graviton5-m9g',
			'whats-new-v2#launch-nitro-enclaves',
			'whats-new-v2#launch-shared-nitro-graviton',
		]);
		// Each query gets its own feeds-table state row keyed by URL.
		expect((await getFeedStates(db)).map((s) => s.feed).sort()).toEqual([
			'https://aws.test/search?q=graviton',
			'https://aws.test/search?q=nitro',
		]);
	});

	it('ingests Cisco IR + EDGAR as one source, and re-polling EDGAR is idempotent (#31)', async () => {
		// #31: the IR press-release feed and the SEC EDGAR 8-K backstop both carry
		// source 'cisco' but use disjoint guid schemes (UUID vs accession number),
		// so an earnings event lands as two rows by design — the PR and the filing.
		// EDGAR filters to Item 2.02 (2 of the fixture's 3 8-Ks survive). A second
		// EDGAR poll returns the same accessions, and (source, guid) ON CONFLICT
		// collapses them — no duplicate rows accrue.
		const irFeed: FeedConfig = {
			source: 'cisco',
			feed: 'https://cisco.test/ir',
			pollIntervalSeconds: 3600,
			parse: (xml) => parseRss20(xml, { content: 'description' }),
		};
		const edgarFeed: FeedConfig = {
			source: 'cisco',
			feed: 'https://cisco.test/edgar',
			pollIntervalSeconds: 3600,
			parse: (json) => parseSecEdgar(json, { cik: '858877', issuer: 'Cisco', items: ['2.02'] }),
		};

		const { fn } = fakeFetch({
			'https://cisco.test/ir': () => new Response(ciscoXml, { status: 200 }),
			'https://cisco.test/edgar': () => new Response(ciscoEdgarJson, { status: 200 }),
		});

		// First tick: 3 IR press releases + 2 Item-2.02 EDGAR filings = 5 rows.
		await ingestAll(deps(fn, 1000), [irFeed, edgarFeed]);
		expect(await listItems(db, 50)).toHaveLength(5);

		// Second tick (feeds now due again): same payloads, no new rows.
		await ingestAll(deps(fn, 1000 + 3600), [irFeed, edgarFeed]);
		const rows = await listItems(db, 50);
		expect(rows).toHaveLength(5);
		// All five share source 'cisco'; the two EDGAR rows are the Item-2.02 ones.
		expect(rows.every((r) => r.source === 'cisco')).toBe(true);
		const guids = rows.map((r) => r.guid);
		expect(guids).toContain('0000858877-26-000075');
		expect(guids).toContain('0000858877-26-000006');
		// The Item-5.02 (non-earnings) 8-K never made it in.
		expect(guids).not.toContain('0000858877-26-000057');
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

describe('ingestAll shape-drift detection (#78)', () => {
	it('emits ingest.anomaly when a 200 parses to ZERO items from a non-empty payload', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const { fn } = fakeFetch({
			'https://cf.test/rss': () => new Response(driftZeroXml, { status: 200 }),
		});

		await ingestAll(deps(fn), [cfFeed]);

		// The smoking-gun anomaly: 3 raw <item>s, 0 parsed. Logged at error level so
		// it surfaces in the Workers Logs error stream, with the queryable `kind`.
		expect(errSpy).toHaveBeenCalledWith({
			level: 'error',
			event: 'ingest.anomaly',
			source: 'cf',
			feed: 'https://cf.test/rss',
			kind: 'zero_parsed_of_raw',
			rawCount: 3,
			parsedCount: 0,
			missingFields: undefined,
			invalidCount: undefined,
		});

		// The poll is still recorded as a normal 200 (we don't abort on an anomaly —
		// we store whatever parsed, which here is nothing, and reschedule healthily).
		const [state] = await getFeedStates(db);
		expect(state).toMatchObject({ last_status: 200, failure_count: 0 });
		expect(await listItems(db, 10)).toEqual([]);
	});

	it('emits a missing_required_fields anomaly when parsed items lack a required field', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const { fn } = fakeFetch({
			'https://cf.test/rss': () => new Response(driftMissingFieldsXml, { status: 200 }),
		});

		await ingestAll(deps(fn), [cfFeed]);

		// Both items parse (they have a link → guid) but with empty titles.
		expect(errSpy).toHaveBeenCalledWith({
			level: 'error',
			event: 'ingest.anomaly',
			source: 'cf',
			feed: 'https://cf.test/rss',
			kind: 'missing_required_fields',
			rawCount: 2,
			parsedCount: 2,
			missingFields: 'title',
			invalidCount: 2,
		});

		// The items still land — an anomaly is a signal, not a hard reject.
		expect(await listItems(db, 10)).toHaveLength(2);
	});

	it('does NOT emit an anomaly for a healthy feed', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const { fn } = fakeFetch({
			'https://cf.test/rss': () => new Response(cloudflareXml, { status: 200 }),
		});

		await ingestAll(deps(fn), [cfFeed]);

		expect(errSpy).not.toHaveBeenCalled();
		expect(await listItems(db, 10)).toHaveLength(2);
	});

	it('does NOT emit an anomaly for a legitimately empty feed (0 raw, 0 parsed)', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const emptyRss =
			'<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>';
		const { fn } = fakeFetch({
			'https://cf.test/rss': () => new Response(emptyRss, { status: 200 }),
		});

		await ingestAll(deps(fn), [cfFeed]);

		// The distinction the issue insists on: an empty feed is normal, not drift.
		expect(errSpy).not.toHaveBeenCalled();
		expect(await listItems(db, 10)).toEqual([]);
	});

	it('skips the zero/drop signal for a feed with no countRaw, but still validates fields', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		// Same drifted-to-zero payload, but this feed declares no raw counter — so
		// the zero-of-N signal can't fire (no denominator) and nothing is flagged.
		const noCounterFeed: FeedConfig = {
			source: 'nc',
			feed: 'https://nc.test/rss',
			pollIntervalSeconds: 3600,
			parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
		};
		const { fn } = fakeFetch({
			'https://nc.test/rss': () => new Response(driftZeroXml, { status: 200 }),
		});

		await ingestAll(deps(fn), [noCounterFeed]);

		expect(errSpy).not.toHaveBeenCalled();
	});

	it('degrades to field-only validation if a feed countRaw throws (no feed error)', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		// A counter that blows up must not turn a healthy 200 into an ingest.error;
		// the parse already succeeded, so we just skip the zero/drop check.
		const throwingCounterFeed: FeedConfig = {
			...cfFeed,
			source: 'tc',
			feed: 'https://tc.test/rss',
			countRaw: () => {
				throw new Error('counter boom');
			},
		};
		const { fn } = fakeFetch({
			'https://tc.test/rss': () => new Response(cloudflareXml, { status: 200 }),
		});

		await ingestAll(deps(fn), [throwingCounterFeed]);

		// No anomaly, no error — the poll succeeds and the items land.
		expect(errSpy).not.toHaveBeenCalled();
		expect(await listItems(db, 10)).toHaveLength(2);
		const [state] = await getFeedStates(db);
		expect(state).toMatchObject({ last_status: 200, failure_count: 0 });
	});

	it('a drifted feed does not abort its peers (per-feed isolation holds)', async () => {
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const driftedFeed: FeedConfig = { ...cfFeed, source: 'drifted', feed: 'https://drift.test/rss' };
		const healthyFeed: FeedConfig = { ...cfFeed, source: 'healthy', feed: 'https://healthy.test/rss' };

		const { fn } = fakeFetch({
			'https://drift.test/rss': () => new Response(driftZeroXml, { status: 200 }),
			'https://healthy.test/rss': () => new Response(cloudflareXml, { status: 200 }),
		});

		await ingestAll(deps(fn), [driftedFeed, healthyFeed]);

		// The drifted feed logged its anomaly...
		expect(errSpy).toHaveBeenCalledWith(
			expect.objectContaining({ event: 'ingest.anomaly', source: 'drifted' }),
		);
		// ...and the healthy peer ingested unaffected (its 2 items are present).
		const rows = await listItems(db, 10);
		expect(rows).toHaveLength(2);
		expect(rows.every((r) => r.source === 'healthy')).toBe(true);
		// Both feeds recorded a clean 200 — the anomaly is informational, not a failure.
		const states = new Map((await getFeedStates(db)).map((s) => [s.feed, s]));
		expect(states.get('https://drift.test/rss')).toMatchObject({ last_status: 200, failure_count: 0 });
		expect(states.get('https://healthy.test/rss')).toMatchObject({ last_status: 200, failure_count: 0 });
	});
});
