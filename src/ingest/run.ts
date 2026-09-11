import { fetchFeed, DEFAULT_POLL_LIMITS, type PollLimits } from './bounded-fetch';
import { startPoll, finishPoll, startRun, finishRun } from './health-db';
import { log } from '../lib/log';
import {
	ensureFeedRows,
	getFeedStates,
	insertItems,
	updateFeedState,
	type FeedState,
} from './db';
import { keepItems } from './merge';
import {
	dueFeeds,
	failurePatch,
	nextPollAt,
	notModifiedPatch,
	pollHeaders,
	successPatch,
} from './schedule';
import type { FeedConfig, ParsedItem } from './types';
import { validateParse } from './validate';

// Identifies us to feed origins; SEC EDGAR (a future source) requires a
// contact-bearing UA, and it's polite everywhere else.
const USER_AGENT = 'news.cuteteal.com aggregator (connor@couetil.com)';

export interface IngestDeps {
	db: D1Database;
	fetchFn: typeof fetch;
	// Current time in unix seconds; injected so tests are deterministic.
	now(): number;
	limits?: PollLimits;
}

// Poll every due feed once. Each feed is isolated: a fetch/parse/DB error for
// one records a failure and moves on, never aborting the others or the tick.
export async function ingestAll(deps: IngestDeps, feeds: FeedConfig[]): Promise<void> {
	const { db, now } = deps;
	const runId = await startRun(db, now());
	let polled = 0;
	let failed = 0;
	let anomalies = 0;
	try {
		await ensureFeedRows(db, feeds);
		const states = new Map((await getFeedStates(db)).map((s) => [s.feed, s]));
		for (const { config, state } of dueFeeds(feeds, states, now())) {
			const outcome = await pollFeed(deps, config, state);
			polled++;
			if (outcome === 'failure') failed++;
			if (outcome === 'anomaly') anomalies++;
		}
		await finishRun(db, runId, now(), polled, failed, anomalies, null);
	} catch (error) {
		await finishRun(db, runId, now(), polled, failed, anomalies, String(error).slice(0, 500));
		throw error;
	}
}

// The imperative shell for one poll (#349): fetch, execute the pure decisions
// from schedule.ts/merge.ts/validate.ts, write the results to D1, log. The only
// branching left here is outcome plumbing (status dispatch + error isolation).
async function pollFeed(deps: IngestDeps, config: FeedConfig, state: FeedState): Promise<'ok' | 'anomaly' | 'failure'> {
	const { db, fetchFn, now } = deps;
	const rescheduleAt = nextPollAt(now(), config.pollIntervalSeconds);

	let responseStatus: number | null = null;
	await startPoll(db, config.feed, now());
	try {
		const res = await fetchFeed(config, fetchFn, { headers: pollHeaders(USER_AGENT, state) },
			deps.limits ?? DEFAULT_POLL_LIMITS, (status) => { responseStatus = status; });

		// Not modified since last poll: nothing to parse, just reschedule.
		if (res.status === 304) {
			await updateFeedState(db, config.feed, notModifiedPatch(state, rescheduleAt));
			await finishPoll(db, config.feed, now(), {status: res.status, error: null, anomaly: null, notModified: true});
			log.info('ingest.poll', {
				source: config.source,
				feed: config.feed,
				status: 304,
				outcome: 'not_modified',
			});
			return 'ok';
		}

		if (res.status !== 200) {
			throw new Error(`unexpected status ${res.status}`);
		}

		const body = res.body;
		const items = config.parse(body);

		// Shape-drift check (#78): a successful 200 can still be silently broken —
		// the parser may no longer recognise the entries, or pull junk into required
		// fields. Detect that BEFORE the writes (so a drifted poll is flagged even
		// though we still store whatever we got) and emit a distinct, queryable
		// signal. Isolated from the happy path: a counter/validate fault must never
		// turn a healthy poll into a feed error, so it can't escape this helper.
		const anomaly = reportAnomaly(config, body, items);

		// Editorial filter (#321): drop known noise (e.g. AWS region-rollout
		// announcements) AFTER the shape-drift check — the anomaly comparison above
		// must see the full parsed count, or a feed that is legitimately mostly
		// noise would trip parse_drop / zero_parsed_of_raw on every healthy poll —
		// and BEFORE the writes. The `filtered` count is logged below so the drop
		// is visible and quantified, never silent.
		const kept = keepItems(config.keep, items);

		const inserted = await insertItems(db, config.source, kept, now());
		await updateFeedState(
			db,
			config.feed,
			successPatch(res.headers.get('ETag'), res.headers.get('Last-Modified'), rescheduleAt),
		);
		await finishPoll(db, config.feed, now(), {status: res.status, error: null, anomaly, notModified: false});
		log.info('ingest.poll', {
			source: config.source,
			feed: config.feed,
			status: 200,
			items: items.length,
			filtered: items.length - kept.length,
			inserted,
			outcome: 'ok',
		});
		return anomaly ? 'anomaly' : 'ok';
	} catch (err) {
		// failurePatch keeps prior etag/last_modified so a recovered feed can 304.
		await updateFeedState(db, config.feed, failurePatch(state, rescheduleAt));
		await finishPoll(db, config.feed, now(), {status: responseStatus, error: String(err).slice(0, 500), anomaly: null, notModified: false});
		log.error('ingest.error', {
			source: config.source,
			feed: config.feed,
			err: String(err),
		});
		return 'failure';
	}
}

// Compare a 200 poll's raw entries against what parse kept and emit a structured
// `ingest.anomaly` when the result looks like shape drift (see validate.ts for
// the verdicts). Self-contained and non-throwing by contract: it runs inside the
// per-feed try but must never convert a healthy poll into a feed failure, so a
// fault in a feed's `countRaw` is swallowed (the parse already succeeded) and
// degrades to field-only validation rather than aborting the poll or its peers.
function reportAnomaly(config: FeedConfig, body: string, items: ParsedItem[]): string | null {
	let rawCount: number | null = null;
	if (config.countRaw) {
		try {
			rawCount = config.countRaw(body);
		} catch {
			// A raw-counter fault is not a feed error: leave rawCount null so only
			// per-item field validation runs, and don't disturb the successful poll.
			rawCount = null;
		}
	}

	const anomaly = validateParse({ rawCount, items });
	if (!anomaly) return null;

	log.error('ingest.anomaly', {
		source: config.source,
		feed: config.feed,
		kind: anomaly.kind,
		rawCount: anomaly.rawCount,
		parsedCount: anomaly.parsedCount,
		// Only present on the missing-fields verdict; undefined fields are dropped
		// by the log helper's LogFields shape, so a join is safe and self-describing.
		missingFields: anomaly.missingFields?.join(','),
		invalidCount: anomaly.invalidCount,
	});
	return JSON.stringify(anomaly);
}
