import { env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import { ensureFeedRows, insertItems } from '../src/ingest/db';
import { startPoll, finishPoll, startRun, finishRun, getHealthRows, getRecentRuns } from '../src/ingest/health-db';
import type { FeedConfig } from '../src/ingest/types';
const db = env.NEWS_DB;
const config: FeedConfig = { source: 'test', feed: 'https://example.com/feed', pollIntervalSeconds: 3600, parse: () => [] };
beforeEach(async () => { await db.batch([db.prepare('DELETE FROM feeds'), db.prepare('DELETE FROM items'), db.prepare('DELETE FROM ingest_runs')]); await ensureFeedRows(db, [config]); });
it('records the attempt before completion without inventing previous poll history', async () => {
	expect((await getHealthRows(db))[0]).toMatchObject({ last_attempt_at: null, last_success_at: null, last_saved_at: null, item_count: 0 });
	await startPoll(db, config.feed, 100);
	expect((await getHealthRows(db))[0]).toMatchObject({ last_attempt_at: 100, last_finished_at: null, response_status: null });
	await finishPoll(db, config.feed, 101, { status: 503, error: 'upstream503', anomaly: null, notModified: false });
	expect((await getHealthRows(db))[0]).toMatchObject({ last_finished_at: 101, response_status: 503, last_success_at: null, last_error: 'upstream503', last_error_at: 101, error_resolved_at: null });
	await startPoll(db, config.feed, 200);
	expect((await getHealthRows(db))[0]).toMatchObject({ last_attempt_at: 200, response_status: null, last_error: 'upstream503' });
	await finishPoll(db, config.feed, 201, { status: 304, error: null, anomaly: null, notModified: true });
	expect((await getHealthRows(db))[0]).toMatchObject({ last_success_at: 201, last_clean_at: null, last_error: 'upstream503', error_resolved_at: 201 });
	await db.prepare('DELETE FROM feeds').run();
	expect((await db.prepare('SELECT COUNT(*) AS n FROM feed_health').first<{
		n: number;
	}>())!.n).toBe(0);
});
it('preserves unresolved anomalies across304 and errors, clearing only after fresh clean content', async () => {
	await startPoll(db, config.feed, 100);
	await finishPoll(db, config.feed, 101, { status: 200, error: null, anomaly: 'zero_parsed_of_raw', notModified: false });
	await finishPoll(db, config.feed, 201, { status: 304, error: null, anomaly: null, notModified: true });
	expect((await getHealthRows(db))[0]).toMatchObject({ last_success_at: 201, last_clean_at: null, last_anomaly: 'zero_parsed_of_raw', last_anomaly_at: 101, anomaly_resolved_at: null });
	await finishPoll(db, config.feed, 301, { status: null, error: 'timeout', anomaly: null, notModified: false });
	expect((await getHealthRows(db))[0].anomaly_resolved_at).toBeNull();
	await finishPoll(db, config.feed, 401, { status: 200, error: null, anomaly: null, notModified: false });
	await finishPoll(db, config.feed, 501, { status: 200, error: null, anomaly: null, notModified: false });
	expect((await getHealthRows(db))[0]).toMatchObject({ last_success_at: 501, last_clean_at: 501, last_anomaly: 'zero_parsed_of_raw', anomaly_resolved_at: 401, last_error: 'timeout', error_resolved_at: 401 });
	await finishPoll(db, config.feed, 601, { status: 200, error: null, anomaly: 'new anomaly', notModified: false });
	expect((await getHealthRows(db))[0]).toMatchObject({ last_anomaly: 'new anomaly', last_anomaly_at: 601, anomaly_resolved_at: null });
});
it('reports insert/publication freshness separately from polling success, shared per source', async () => {
	await insertItems(db, 'test', [{ guid: 'g', url: 'https://example.com/story', title: 'Story', summary: null, contentHtml: null, publishedAt: 50 }], 80);
	await startPoll(db, config.feed, 100);
	await finishPoll(db, config.feed, 101, { status: 200, error: null, anomaly: null, notModified: false });
	await finishPoll(db, config.feed, 201, { status: 304, error: null, anomaly: null, notModified: true });
	expect((await getHealthRows(db))[0]).toMatchObject({ last_saved_at: 80, last_published_at: 50, item_count: 1, last_success_at: 201 });
});
it('keeps overlapping starts and completions distinct and bounded run history', async () => {
	const older = await startRun(db, 100);
	const newer = await startRun(db, 200);
	await finishRun(db, older, 300, 2, 1, 0, null);
	let runs = await getRecentRuns(db);
	expect(runs.map(r => r.id)).toEqual([newer, older]);
	expect(runs[0].finished_at).toBeNull();
	expect(runs[1]).toMatchObject({ finished_at: 300, failed_feeds: 1 });
	await finishRun(db, newer, 400, 1, 0, 1, 'fatal batch problem');
	expect((await getRecentRuns(db))[0]).toMatchObject({ error: 'fatal batch problem', anomalous_feeds: 1 });
	await db.batch(Array.from({ length: 200 }, () => db.prepare('INSERT INTO ingest_runs(started_at) VALUES (500)')));
	await finishRun(db, newer, 600, 1, 0, 0, null);
	expect((await db.prepare('SELECT COUNT(*) AS n FROM ingest_runs').first<{
		n: number;
	}>())!.n).toBe(192);
	expect(await getRecentRuns(db)).toHaveLength(12);
});
