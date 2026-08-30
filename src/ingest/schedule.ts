import type { FeedState, FeedStatePatch } from './db';
import type { FeedConfig } from './types';

// Pure poll-lifecycle decisions (#349): when a feed is due, when it polls next,
// which conditional headers a poll sends, and the exact feeds-table patch each
// poll outcome writes back. Extracted from run.ts so the decisions are plain
// functions — node-tested (test/schedule.test.ts + test/schedule.prop.test.ts)
// and in Stryker's mutation scope — while run.ts keeps only the I/O plumbing
// (fetch, D1 writes, logging) that executes what these return.

// A feed is due when its next_poll_at has arrived: `next_poll_at <= now`
// (equality IS due — a brand-new row's next_poll_at of 0 and a row rescheduled
// to exactly `now` both poll). Equivalently: now - lastPolled >= pollInterval,
// since next_poll_at is set to pollTime + pollIntervalSeconds.
export function isDue(state: Pick<FeedState, 'next_poll_at'>, now: number): boolean {
	return state.next_poll_at <= now;
}

// The tick's due set, in config order: each configured feed paired with its
// state row, filtered to the ones due at `now`. One clock snapshot decides the
// whole tick — a feed coming due mid-tick waits for the next tick. The caller
// (ingestAll) guarantees a state row exists for every config via ensureFeedRows,
// so the lookup is asserted non-null rather than branch-guarded.
export function dueFeeds(
	feeds: readonly FeedConfig[],
	states: ReadonlyMap<string, FeedState>,
	now: number,
): Array<{ config: FeedConfig; state: FeedState }> {
	return feeds
		.map((config) => ({ config, state: states.get(config.feed)! }))
		.filter(({ state }) => isDue(state, now));
}

// When a feed polled at `now` is next due, whatever the poll's outcome —
// success, 304, and failure all reschedule one full interval out.
export function nextPollAt(now: number, pollIntervalSeconds: number): number {
	return now + pollIntervalSeconds;
}

// The request headers for one poll: the identifying User-Agent always, plus a
// conditional validator for each one the last successful response supplied — so
// an origin that gave us an ETag/Last-Modified can answer 304.
export function pollHeaders(
	userAgent: string,
	state: Pick<FeedState, 'etag' | 'last_modified'>,
): Record<string, string> {
	const headers: Record<string, string> = { 'User-Agent': userAgent };
	if (state.etag) headers['If-None-Match'] = state.etag;
	if (state.last_modified) headers['If-Modified-Since'] = state.last_modified;
	return headers;
}

// 304 Not Modified: nothing new — keep the stored validators (they're still
// current), record the 304, clear the failure streak, and reschedule.
export function notModifiedPatch(state: FeedState, nextPollAt: number): FeedStatePatch {
	return {
		etag: state.etag,
		lastModified: state.last_modified,
		nextPollAt,
		lastStatus: 304,
		failureCount: 0,
	};
}

// A successful 200: store the response's validators (null when the origin sent
// none — a stale validator must not survive a full response), record the 200,
// clear the failure streak, and reschedule.
export function successPatch(
	etag: string | null,
	lastModified: string | null,
	nextPollAt: number,
): FeedStatePatch {
	return { etag, lastModified, nextPollAt, lastStatus: 200, failureCount: 0 };
}

// Any poll failure (bad status, fetch/parse/DB error): keep the prior
// validators so a recovered feed can still 304, keep the last CONFIRMED status
// (nothing new was confirmed), extend the failure streak by one, and reschedule
// normally — one bad poll never tightens or loosens the cadence.
export function failurePatch(state: FeedState, nextPollAt: number): FeedStatePatch {
	return {
		etag: state.etag,
		lastModified: state.last_modified,
		nextPollAt,
		lastStatus: state.last_status,
		failureCount: state.failure_count + 1,
	};
}
