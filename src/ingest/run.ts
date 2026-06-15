import { log } from '../lib/log';
import {
	ensureFeedRows,
	getFeedStates,
	insertItems,
	updateFeedState,
	type FeedState,
} from './db';
import type { FeedConfig } from './types';

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

		const items = config.parse(await res.text());
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
