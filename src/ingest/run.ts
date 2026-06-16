import { log } from '../lib/log';
import {
	ensureFeedRows,
	getFeedStates,
	insertItems,
	updateFeedState,
	type FeedState,
} from './db';
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
}

// Poll every due feed once. Each feed is isolated: a fetch/parse/DB error for
// one records a failure and moves on, never aborting the others or the tick.
export async function ingestAll(deps: IngestDeps, feeds: FeedConfig[]): Promise<void> {
	const { db, now } = deps;
	await ensureFeedRows(db, feeds);

	const states = new Map((await getFeedStates(db)).map((s) => [s.feed, s]));
	for (const config of feeds) {
		// ensureFeedRows just guaranteed a row for every config.feed.
		const state = states.get(config.feed)!;
		if (state.next_poll_at > now()) continue;
		await pollFeed(deps, config, state);
	}
}

async function pollFeed(deps: IngestDeps, config: FeedConfig, state: FeedState): Promise<void> {
	const { db, fetchFn, now } = deps;
	const nextPollAt = now() + config.pollIntervalSeconds;

	try {
		const headers: Record<string, string> = { 'User-Agent': USER_AGENT };
		if (state.etag) headers['If-None-Match'] = state.etag;
		if (state.last_modified) headers['If-Modified-Since'] = state.last_modified;

		const res = await fetchFn(config.feed, { headers });

		// Not modified since last poll: nothing to parse, just reschedule.
		if (res.status === 304) {
			await updateFeedState(db, config.feed, {
				etag: state.etag,
				lastModified: state.last_modified,
				nextPollAt,
				lastStatus: 304,
				failureCount: 0,
			});
			log.info('ingest.poll', {
				source: config.source,
				feed: config.feed,
				status: 304,
				outcome: 'not_modified',
			});
			return;
		}

		if (res.status !== 200) {
			throw new Error(`unexpected status ${res.status}`);
		}

		const body = await res.text();
		const items = config.parse(body);

		// Shape-drift check (#78): a successful 200 can still be silently broken —
		// the parser may no longer recognise the entries, or pull junk into required
		// fields. Detect that BEFORE the writes (so a drifted poll is flagged even
		// though we still store whatever we got) and emit a distinct, queryable
		// signal. Isolated from the happy path: a counter/validate fault must never
		// turn a healthy poll into a feed error, so it can't escape this helper.
		reportAnomaly(config, body, items);

		const inserted = await insertItems(db, config.source, items, now());
		await updateFeedState(db, config.feed, {
			etag: res.headers.get('ETag'),
			lastModified: res.headers.get('Last-Modified'),
			nextPollAt,
			lastStatus: 200,
			failureCount: 0,
		});
		log.info('ingest.poll', {
			source: config.source,
			feed: config.feed,
			status: 200,
			items: items.length,
			inserted,
			outcome: 'ok',
		});
	} catch (err) {
		// Keep prior etag/last_modified so a recovered feed can still 304.
		await updateFeedState(db, config.feed, {
			etag: state.etag,
			lastModified: state.last_modified,
			nextPollAt,
			lastStatus: state.last_status,
			failureCount: state.failure_count + 1,
		});
		log.error('ingest.error', {
			source: config.source,
			feed: config.feed,
			err: String(err),
		});
	}
}

// Compare a 200 poll's raw entries against what parse kept and emit a structured
// `ingest.anomaly` when the result looks like shape drift (see validate.ts for
// the verdicts). Self-contained and non-throwing by contract: it runs inside the
// per-feed try but must never convert a healthy poll into a feed failure, so a
// fault in a feed's `countRaw` is swallowed (the parse already succeeded) and
// degrades to field-only validation rather than aborting the poll or its peers.
function reportAnomaly(config: FeedConfig, body: string, items: ParsedItem[]): void {
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
	if (!anomaly) return;

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
}
