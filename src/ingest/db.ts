import type { FeedConfig, ParsedItem } from './types';

// A row of the feeds state table (see migrations/0001_init.sql).
export interface FeedState {
	feed: string;
	source: string;
	etag: string | null;
	last_modified: string | null;
	next_poll_at: number;
	last_status: number | null;
	failure_count: number;
	state_json: string | null;
}

// A row of the items table, as the homepage reads it.
export interface ItemRow {
	id: number;
	source: string;
	guid: string;
	url: string;
	title: string;
	summary: string | null;
	content_html: string | null;
	published_at: number | null;
	fetched_at: number;
	// Unix seconds when the reader marked this read; null while it's unread.
	read_at: number | null;
}

// What a poll learned about a feed, written back after each attempt.
export interface FeedStatePatch {
	etag: string | null;
	lastModified: string | null;
	nextPollAt: number;
	lastStatus: number | null;
	failureCount: number;
}

// Create a state row for each configured endpoint that doesn't have one yet.
// Defaults (next_poll_at = 0) make a brand-new feed immediately due. Idempotent
// across ticks via ON CONFLICT, so source config can grow without a migration.
export async function ensureFeedRows(db: D1Database, feeds: FeedConfig[]): Promise<void> {
	await db.batch(
		feeds.map((f) =>
			db
				.prepare('INSERT INTO feeds (feed, source) VALUES (?, ?) ON CONFLICT(feed) DO NOTHING')
				.bind(f.feed, f.source),
		),
	);
}

export async function getFeedStates(db: D1Database): Promise<FeedState[]> {
	const { results } = await db.prepare('SELECT * FROM feeds').all<FeedState>();
	return results;
}

// Insert parsed items under one source, ignoring any whose (source, guid)
// already exists — this is the dedupe mechanism. Returns how many were new.
export async function insertItems(
	db: D1Database,
	source: string,
	items: ParsedItem[],
	fetchedAt: number,
): Promise<number> {
	if (items.length === 0) return 0;
	const results = await db.batch(
		items.map((it) =>
			db
				.prepare(
					`INSERT INTO items
						(source, guid, url, title, summary, content_html, published_at, fetched_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
					 ON CONFLICT(source, guid) DO NOTHING`,
				)
				.bind(source, it.guid, it.url, it.title, it.summary, it.contentHtml, it.publishedAt, fetchedAt),
		),
	);
	return results.reduce((sum, r) => sum + r.meta.changes, 0);
}

export async function updateFeedState(
	db: D1Database,
	feed: string,
	patch: FeedStatePatch,
): Promise<void> {
	await db
		.prepare(
			`UPDATE feeds
			 SET etag = ?, last_modified = ?, next_poll_at = ?, last_status = ?, failure_count = ?
			 WHERE feed = ?`,
		)
		.bind(patch.etag, patch.lastModified, patch.nextPollAt, patch.lastStatus, patch.failureCount, feed)
		.run();
}

// Newest items across all sources, unread first. `read_at IS NOT NULL` sorts
// unread (0) ahead of read (1) so the homepage can split them into a live feed
// and a "Read" section below without a second query; within each group,
// COALESCE keeps an item with no published_at sorted by when we fetched it, and
// id breaks ties deterministically.
export async function listItems(db: D1Database, limit: number): Promise<ItemRow[]> {
	const { results } = await db
		.prepare(
			`SELECT id, source, guid, url, title, summary, content_html, published_at, fetched_at, read_at
			 FROM items
			 ORDER BY (read_at IS NOT NULL), COALESCE(published_at, fetched_at) DESC, id DESC
			 LIMIT ?`,
		)
		.bind(limit)
		.all<ItemRow>();
	return results;
}

// Flip one item's read state: readAt = unix seconds marks it read, null marks
// it unread. The homepage's read/unread toggle posts to /api/read, which calls
// this and redirects back so the feature works without JavaScript.
export async function setItemRead(
	db: D1Database,
	id: number,
	readAt: number | null,
): Promise<void> {
	await db.prepare('UPDATE items SET read_at = ? WHERE id = ?').bind(readAt, id).run();
}
