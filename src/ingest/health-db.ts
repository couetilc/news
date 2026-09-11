import type { FeedState } from './db';
export interface FeedHealth extends FeedState {
	last_attempt_at: number | null;
	last_finished_at: number | null;
	response_status: number | null;
	last_success_at: number | null;
	last_clean_at: number | null;
	last_error: string | null;
	last_error_at: number | null;
	error_resolved_at: number | null;
	last_anomaly: string | null;
	last_anomaly_at: number | null;
	anomaly_resolved_at: number | null;
	last_saved_at: number | null;
	last_published_at: number | null;
	item_count: number;
}

export interface IngestRun {
	id: number;
	started_at: number;
	finished_at: number | null;
	polled: number;
	failed_feeds: number;
	anomalous_feeds: number;
	error: string | null;
}

export interface PollHealthResult {
	status: number | null;
	error: string | null;
	anomaly: string | null;
	notModified: boolean;
}

export async function startPoll(db: D1Database, feed: string, at: number): Promise<void> {
	await db.prepare(`INSERT INTO feed_health(feed,last_attempt_at) VALUES (?,?)
		ON CONFLICT(feed) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,response_status=NULL`)
		.bind(feed, at).run();
}

export async function finishPoll(db: D1Database, feed: string, at: number, result: PollHealthResult): Promise<void> {
	const { status, error, anomaly, notModified } = result;
	await db.prepare(`UPDATE feed_health SET last_finished_at=?, response_status=?,
		last_success_at=CASE WHEN ? IS NULL THEN ? ELSE last_success_at END,
		last_clean_at=CASE WHEN ? IS NULL AND ? IS NULL AND ?=0 THEN ? ELSE last_clean_at END,
		last_error=COALESCE(?,last_error), last_error_at=CASE WHEN ? IS NOT NULL THEN ? ELSE last_error_at END,
		error_resolved_at=CASE WHEN ? IS NOT NULL THEN NULL WHEN last_error IS NOT NULL AND error_resolved_at IS NULL THEN ? ELSE error_resolved_at END,
		last_anomaly=COALESCE(?,last_anomaly), last_anomaly_at=CASE WHEN ? IS NOT NULL THEN ? ELSE last_anomaly_at END,
		anomaly_resolved_at=CASE WHEN ? IS NOT NULL THEN NULL
			WHEN ? IS NULL AND ?=0 AND last_anomaly IS NOT NULL AND anomaly_resolved_at IS NULL THEN ? ELSE anomaly_resolved_at END
		WHERE feed=?`).bind(at, status, error, at, error, anomaly, Number(notModified), at, error, error, at, error, at, anomaly, anomaly, at, anomaly, error, Number(notModified), at, feed).run();
}

export async function startRun(db: D1Database, at: number): Promise<number> {
	const row = await db.prepare('INSERT INTO ingest_runs(started_at) VALUES (?) RETURNING id').bind(at).first<{
		id: number;
	}>();
	return row!.id;
}

export async function finishRun(db: D1Database, id: number, at: number, polled: number, failed: number, anomalies: number, error: string | null): Promise<void> {
	await db.prepare('UPDATE ingest_runs SET finished_at=?,polled=?,failed_feeds=?,anomalous_feeds=?,error=? WHERE id=?')
		.bind(at, polled, failed, anomalies, error, id).run();
	// Keep a bounded recent history (at least a day at the current cadence).
	await db.prepare('DELETE FROM ingest_runs WHERE id NOT IN (SELECT id FROM ingest_runs ORDER BY id DESC LIMIT 192)').run();
}

export async function getHealthRows(db: D1Database): Promise<FeedHealth[]> {
	const { results } = await db.prepare(`SELECT f.*,h.last_attempt_at,h.last_finished_at,h.response_status,
		h.last_success_at,h.last_clean_at,h.last_error,h.last_error_at,h.error_resolved_at,
		h.last_anomaly,h.last_anomaly_at,h.anomaly_resolved_at,
		i.last_saved_at,i.last_published_at,COALESCE(i.item_count,0) AS item_count
		FROM feeds f LEFT JOIN feed_health h ON h.feed=f.feed
		LEFT JOIN (SELECT source,MAX(fetched_at) AS last_saved_at,MAX(published_at) AS last_published_at,COUNT(*) AS item_count
			FROM items GROUP BY source) i ON i.source=f.source`).all<FeedHealth>();
	return results;
}

export async function getRecentRuns(db: D1Database): Promise<IngestRun[]> {
	const { results } = await db.prepare('SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 12').all<IngestRun>();
	return results;
}
