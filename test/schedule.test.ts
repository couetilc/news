import { describe, expect, it } from 'vitest';
import type { FeedState } from '../src/ingest/db';
import {
	dueFeeds,
	failurePatch,
	isDue,
	nextPollAt,
	notModifiedPatch,
	pollHeaders,
	successPatch,
} from '../src/ingest/schedule';
import type { FeedConfig } from '../src/ingest/types';

// Example tests for the pure poll-lifecycle core (#349), extracted from
// run.ts. These pin the exact boundary decisions and patch shapes; the
// invariants across the whole input space live in test/schedule.prop.test.ts,
// and run.test.ts (workers project) proves the shell executes these decisions
// against real D1. Plain node — in Stryker's mutation scope.

const state = (over: Partial<FeedState> = {}): FeedState => ({
	feed: 'https://example.com/feed',
	source: 'src',
	etag: null,
	last_modified: null,
	next_poll_at: 0,
	last_status: null,
	failure_count: 0,
	state_json: null,
	...over,
});

const config = (over: Partial<FeedConfig> = {}): FeedConfig => ({
	source: 'src',
	feed: 'https://example.com/feed',
	pollIntervalSeconds: 3600,
	parse: () => [],
	...over,
});

describe('isDue', () => {
	it('is due when next_poll_at has passed, INCLUSIVE of the exact boundary', () => {
		expect(isDue(state({ next_poll_at: 999 }), 1000)).toBe(true);
		expect(isDue(state({ next_poll_at: 1000 }), 1000)).toBe(true); // equality IS due
		expect(isDue(state({ next_poll_at: 1001 }), 1000)).toBe(false);
	});

	it('a brand-new row (next_poll_at 0) is immediately due', () => {
		expect(isDue(state({ next_poll_at: 0 }), 0)).toBe(true);
	});
});

describe('dueFeeds', () => {
	it('pairs each due config with its state row, preserving config order', () => {
		const a = config({ feed: 'https://a.test/rss' });
		const b = config({ feed: 'https://b.test/rss' });
		const c = config({ feed: 'https://c.test/rss' });
		const sa = state({ feed: a.feed, next_poll_at: 500 });
		const sb = state({ feed: b.feed, next_poll_at: 5000 }); // not yet due
		const sc = state({ feed: c.feed, next_poll_at: 1000 });
		const states = new Map([
			[a.feed, sa],
			[b.feed, sb],
			[c.feed, sc],
		]);

		expect(dueFeeds([a, b, c], states, 1000)).toEqual([
			{ config: a, state: sa },
			{ config: c, state: sc },
		]);
	});

	it('returns [] for no feeds and for a tick where nothing is due', () => {
		expect(dueFeeds([], new Map(), 1000)).toEqual([]);
		const a = config();
		const states = new Map([[a.feed, state({ next_poll_at: 2000 })]]);
		expect(dueFeeds([a], states, 1000)).toEqual([]);
	});
});

describe('nextPollAt', () => {
	it('reschedules exactly one interval out', () => {
		expect(nextPollAt(1000, 3600)).toBe(4600);
		expect(nextPollAt(0, 0)).toBe(0);
	});
});

describe('pollHeaders', () => {
	const UA = 'news.cuteteal.com aggregator (connor@couetil.com)';

	it('always sends the identifying User-Agent; no conditionals on a first poll', () => {
		expect(pollHeaders(UA, state())).toEqual({ 'User-Agent': UA });
	});

	it('sends each stored validator as its conditional header', () => {
		expect(pollHeaders(UA, state({ etag: 'v1' }))).toEqual({
			'User-Agent': UA,
			'If-None-Match': 'v1',
		});
		expect(pollHeaders(UA, state({ last_modified: 'Thu, 12 Jun 2026 14:00:00 GMT' }))).toEqual({
			'User-Agent': UA,
			'If-Modified-Since': 'Thu, 12 Jun 2026 14:00:00 GMT',
		});
		expect(
			pollHeaders(UA, state({ etag: 'v1', last_modified: 'Thu, 12 Jun 2026 14:00:00 GMT' })),
		).toEqual({
			'User-Agent': UA,
			'If-None-Match': 'v1',
			'If-Modified-Since': 'Thu, 12 Jun 2026 14:00:00 GMT',
		});
	});

	it('treats an empty-string validator as absent (never sends an empty header)', () => {
		expect(pollHeaders(UA, state({ etag: '', last_modified: '' }))).toEqual({
			'User-Agent': UA,
		});
	});
});

describe('the three feed-state patches', () => {
	const prior = state({
		etag: 'old-etag',
		last_modified: 'Wed, 10 Jun 2026 12:00:00 GMT',
		next_poll_at: 0,
		last_status: 200,
		failure_count: 2,
	});

	it('notModifiedPatch keeps the stored validators, records 304, clears failures', () => {
		expect(notModifiedPatch(prior, 4600)).toEqual({
			etag: 'old-etag',
			lastModified: 'Wed, 10 Jun 2026 12:00:00 GMT',
			nextPollAt: 4600,
			lastStatus: 304,
			failureCount: 0,
		});
	});

	it('successPatch stores the RESPONSE validators (null clears a stale one), records 200, clears failures', () => {
		expect(successPatch('v2', 'Thu, 12 Jun 2026 14:00:00 GMT', 4600)).toEqual({
			etag: 'v2',
			lastModified: 'Thu, 12 Jun 2026 14:00:00 GMT',
			nextPollAt: 4600,
			lastStatus: 200,
			failureCount: 0,
		});
		// An origin that stopped sending validators must not leave stale ones.
		expect(successPatch(null, null, 4600)).toEqual({
			etag: null,
			lastModified: null,
			nextPollAt: 4600,
			lastStatus: 200,
			failureCount: 0,
		});
	});

	it('failurePatch keeps validators AND last confirmed status, extends the streak by one', () => {
		expect(failurePatch(prior, 4600)).toEqual({
			etag: 'old-etag',
			lastModified: 'Wed, 10 Jun 2026 12:00:00 GMT',
			nextPollAt: 4600,
			lastStatus: 200, // unchanged: nothing new was confirmed
			failureCount: 3,
		});
	});
});
