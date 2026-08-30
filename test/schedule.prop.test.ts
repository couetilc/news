import fc from 'fast-check';
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

// Property tests for the scheduling core (#349): the invariants that must hold
// across the whole input space, complementing the boundary examples in
// test/schedule.test.ts. A fixed seed makes any failure reproducible (repo
// convention — see test/pagination.prop.test.ts).
const SEED = 0x163;

// Unix-seconds-shaped integers (comfortably past 2100, plus 0 and small values
// so the epoch/boundary region is explored).
const unixSeconds = fc.integer({ min: 0, max: 5_000_000_000 });
const interval = fc.integer({ min: 0, max: 10_000_000 });

const arbState = (feed: string): fc.Arbitrary<FeedState> =>
	fc.record({
		feed: fc.constant(feed),
		source: fc.constant('src'),
		etag: fc.option(fc.string(), { nil: null }),
		last_modified: fc.option(fc.string(), { nil: null }),
		next_poll_at: unixSeconds,
		last_status: fc.option(fc.constantFrom(200, 304, 404, 500), { nil: null }),
		failure_count: fc.nat({ max: 1_000 }),
		state_json: fc.constant(null),
	});

const mkConfig = (feed: string): FeedConfig => ({
	source: 'src',
	feed,
	pollIntervalSeconds: 3600,
	parse: () => [],
});

const baseState = (feed: string): FeedState => ({
	feed,
	source: 'src',
	etag: null,
	last_modified: null,
	next_poll_at: 0,
	last_status: null,
	failure_count: 0,
	state_json: null,
});

// A tick's worth of feeds: distinct URLs, each with an arbitrary next_poll_at
// (the only state field the due decision reads).
const arbTick = fc.uniqueArray(fc.webUrl(), { maxLength: 12 }).chain((urls) =>
	fc
		.array(unixSeconds, { minLength: urls.length, maxLength: urls.length })
		.map((polls) => ({
			configs: urls.map(mkConfig),
			states: new Map(
				urls.map((u, i) => [u, { ...baseState(u), next_poll_at: polls[i] }] as const),
			),
		})),
);

describe('isDue / nextPollAt — property', () => {
	it('a feed is due iff now - lastPolled >= pollInterval', () => {
		// The issue-#349 phrasing of the contract: next_poll_at is written as
		// lastPolled + interval, so due-ness is exactly the elapsed-time test.
		fc.assert(
			fc.property(unixSeconds, unixSeconds, interval, (lastPolled, now, seconds) => {
				const due = isDue({ next_poll_at: nextPollAt(lastPolled, seconds) }, now);
				expect(due).toBe(now - lastPolled >= seconds);
			}),
			{ seed: SEED },
		);
	});
});

describe('dueFeeds — property', () => {
	it('returns exactly the due subset, in config order, each paired with ITS state', () => {
		fc.assert(
			fc.property(arbTick, unixSeconds, ({ configs, states }, now) => {
				const due = dueFeeds(configs, states, now);
				// Never more than configured; never a negative count by construction.
				expect(due.length).toBeLessThanOrEqual(configs.length);
				// Exactly the isDue subset, order preserved.
				const expected = configs.filter((c) => isDue(states.get(c.feed)!, now));
				expect(due.map((d) => d.config)).toEqual(expected);
				// Every pair is internally consistent and actually due.
				for (const { config, state } of due) {
					expect(state).toBe(states.get(config.feed));
					expect(state.next_poll_at).toBeLessThanOrEqual(now);
				}
			}),
			{ seed: SEED },
		);
	});

	it('is monotone in now: a due feed stays due as the clock advances', () => {
		fc.assert(
			fc.property(arbTick, unixSeconds, fc.nat({ max: 1_000_000 }), ({ configs, states }, now, later) => {
				const dueNow = new Set(dueFeeds(configs, states, now).map((d) => d.config.feed));
				const dueLater = new Set(dueFeeds(configs, states, now + later).map((d) => d.config.feed));
				for (const feed of dueNow) expect(dueLater.has(feed)).toBe(true);
			}),
			{ seed: SEED },
		);
	});
});

describe('feed-state patches — property', () => {
	const arb = arbState('https://example.com/feed');

	it('failurePatch extends the streak by EXACTLY one and confirms nothing new', () => {
		fc.assert(
			fc.property(arb, unixSeconds, (s, at) => {
				const patch = failurePatch(s, at);
				expect(patch.failureCount).toBe(s.failure_count + 1);
				// Validators and last confirmed status survive so recovery can 304.
				expect(patch.etag).toBe(s.etag);
				expect(patch.lastModified).toBe(s.last_modified);
				expect(patch.lastStatus).toBe(s.last_status);
				expect(patch.nextPollAt).toBe(at);
			}),
			{ seed: SEED },
		);
	});

	it('any successful outcome (200 or 304) clears the failure streak', () => {
		fc.assert(
			fc.property(
				arb,
				unixSeconds,
				fc.option(fc.string(), { nil: null }),
				fc.option(fc.string(), { nil: null }),
				(s, at, etag, lastModified) => {
					expect(notModifiedPatch(s, at).failureCount).toBe(0);
					expect(notModifiedPatch(s, at).lastStatus).toBe(304);
					expect(successPatch(etag, lastModified, at).failureCount).toBe(0);
					expect(successPatch(etag, lastModified, at).lastStatus).toBe(200);
				},
			),
			{ seed: SEED },
		);
	});

	it('304 keeps the STORED validators; 200 stores the RESPONSE validators verbatim', () => {
		fc.assert(
			fc.property(
				arb,
				unixSeconds,
				fc.option(fc.string(), { nil: null }),
				fc.option(fc.string(), { nil: null }),
				(s, at, etag, lastModified) => {
					const kept = notModifiedPatch(s, at);
					expect(kept.etag).toBe(s.etag);
					expect(kept.lastModified).toBe(s.last_modified);
					const stored = successPatch(etag, lastModified, at);
					expect(stored.etag).toBe(etag);
					expect(stored.lastModified).toBe(lastModified);
				},
			),
			{ seed: SEED },
		);
	});
});

describe('pollHeaders — property', () => {
	it('sends a conditional header iff the stored validator is a non-empty string', () => {
		fc.assert(
			fc.property(
				fc.option(fc.string(), { nil: null }),
				fc.option(fc.string(), { nil: null }),
				(etag, lastModified) => {
					const headers = pollHeaders('ua', {
						etag,
						last_modified: lastModified,
					});
					expect(headers['User-Agent']).toBe('ua');
					expect(headers['If-None-Match']).toBe(etag || undefined);
					expect(headers['If-Modified-Since']).toBe(lastModified || undefined);
				},
			),
			{ seed: SEED },
		);
	});
});
