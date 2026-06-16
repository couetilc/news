import type { FeedConfig, ParsedItem } from './types';
import { sourceMeta } from '../lib/sources';

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

// Newest items, unread first. `read_at IS NOT NULL` sorts unread (0) ahead of
// read (1) so the homepage can split them into a live feed and a "Read" section
// below without a second query; within each group, COALESCE keeps an item with
// no published_at sorted by when we fetched it, and id breaks ties
// deterministically. An optional `sources` list narrows the feed to those source
// slugs (WHERE source IN (...)) for the homepage filter; omitting it or passing
// an empty list returns every source ("All").
export async function listItems(
	db: D1Database,
	limit: number,
	sources: string[] = [],
): Promise<ItemRow[]> {
	const where = sources.length > 0 ? `WHERE source IN (${sources.map(() => '?').join(', ')})` : '';
	const { results } = await db
		.prepare(
			`SELECT id, source, guid, url, title, summary, content_html, published_at, fetched_at, read_at
			 FROM items
			 ${where}
			 ORDER BY (read_at IS NOT NULL), COALESCE(published_at, fetched_at) DESC, id DESC
			 LIMIT ?`,
		)
		.bind(...sources, limit)
		.all<ItemRow>();
	return results;
}

// One paginated section of the homepage digest, for one logged-in user. `read`
// picks the section — false reads the still-unread feed, true reads the "Read"
// section — so each section paginates on its own cursor and walking deep into one
// never disturbs the other. `userId` scopes read state per-user (issue #70): the
// query LEFT JOINs item_reads for that user, so an item is "read" only if THIS
// user has a row there. Within a section the order matches the old single query
// (newest-first, id breaking ties), since the read/unread split is in the WHERE
// clause instead of a sort key. `limit`/`offset` are the page window (50 per
// page; offset = (page-1)*50). The optional `sources` filter narrows by source
// slug, same shape as listItems.
export interface SectionQuery {
	userId: number;
	read: boolean;
	limit: number;
	offset: number;
	sources?: string[];
}

// The per-user read state lives in item_reads keyed by (user_id, item_id), so a
// row's read-ness is "does this user have a join row?" — not the legacy global
// items.read_at column. We LEFT JOIN that user's rows (the join's ON clause binds
// the user id) and read the section off the joined read_at: IS NOT NULL = read
// for this user, IS NULL = unread. The bind order is therefore [userId, ...].
function sectionWhere(read: boolean, sources: string[]): string {
	const readClause = read ? 'r.read_at IS NOT NULL' : 'r.read_at IS NULL';
	const sourceClause = sources.length > 0 ? ` AND i.source IN (${sources.map(() => '?').join(', ')})` : '';
	return `WHERE ${readClause}${sourceClause}`;
}

export async function listItemsByRead(
	db: D1Database,
	{ userId, read, limit, offset, sources = [] }: SectionQuery,
): Promise<ItemRow[]> {
	// r.read_at (this user's timestamp, or NULL) is selected as read_at so the
	// returned ItemRow reflects per-user state, not the global column.
	const { results } = await db
		.prepare(
			`SELECT i.id, i.source, i.guid, i.url, i.title, i.summary, i.content_html,
			        i.published_at, i.fetched_at, r.read_at AS read_at
			 FROM items i
			 LEFT JOIN item_reads r ON r.item_id = i.id AND r.user_id = ?
			 ${sectionWhere(read, sources)}
			 ORDER BY COALESCE(i.published_at, i.fetched_at) DESC, i.id DESC
			 LIMIT ? OFFSET ?`,
		)
		.bind(userId, ...sources, limit, offset)
		.all<ItemRow>();
	return results;
}

// How many items the section holds for this user under the same read state +
// source filter, so the page can compute total pages and decide whether a "next"
// link renders. Same per-user LEFT JOIN as listItemsByRead.
export async function countItemsByRead(
	db: D1Database,
	{ userId, read, sources = [] }: { userId: number; read: boolean; sources?: string[] },
): Promise<number> {
	// COUNT(*) always returns exactly one row (0 for an empty match), so a
	// non-null number is guaranteed — no fallback branch needed.
	const n = await db
		.prepare(
			`SELECT COUNT(*) AS n
			 FROM items i
			 LEFT JOIN item_reads r ON r.item_id = i.id AND r.user_id = ?
			 ${sectionWhere(read, sources)}`,
		)
		.bind(userId, ...sources)
		.first<number>('n');
	return n as number;
}

// The source slugs actually present in the items table — the sources the feed
// can be filtered by, so empty/unregistered registry entries never show. Ordered
// by display name (via sourceMeta) for a stable, human-sensible filter bar.
export async function distinctSources(db: D1Database): Promise<string[]> {
	const { results } = await db
		.prepare('SELECT DISTINCT source FROM items')
		.all<{ source: string }>();
	return results
		.map((r) => r.source)
		.sort((a, b) => sourceMeta(a).name.localeCompare(sourceMeta(b).name));
}

// Flip one item's read state for ONE user (issue #70): readAt = unix seconds
// marks it read, null marks it unread. State is per-user, so this writes the
// (userId, id) row in item_reads rather than the global items column — leaving
// every other user's state untouched. Marking read upserts the timestamp (ON
// CONFLICT keeps "mark read" idempotent if double-submitted); marking unread
// deletes the user's row (absence = unread). The homepage's read/unread toggle
// posts to /api/read, which calls this and redirects back so the feature works
// without JavaScript.
//
// item_reads has no foreign key to items (D1/SQLite migrations can't add one
// after the fact, and the table predates this guard), so the mark-read INSERT is
// sourced from `SELECT ... FROM items WHERE id = ?`: a nonexistent id selects
// zero rows and inserts nothing, instead of persisting an orphan read for an item
// that doesn't exist. Without this, a forged or stale POST for a bogus id would
// leave a row that silently marks a *future* item read once that id is reused
// (#140). Marking unread is already a no-op for an absent row, so it needs no
// such guard.
export async function setItemRead(
	db: D1Database,
	userId: number,
	id: number,
	readAt: number | null,
): Promise<void> {
	if (readAt === null) {
		await db
			.prepare('DELETE FROM item_reads WHERE user_id = ? AND item_id = ?')
			.bind(userId, id)
			.run();
		return;
	}
	await db
		.prepare(
			`INSERT INTO item_reads (user_id, item_id, read_at)
			 SELECT ?, id, ? FROM items WHERE id = ?
			 ON CONFLICT(user_id, item_id) DO UPDATE SET read_at = excluded.read_at`,
		)
		.bind(userId, readAt, id)
		.run();
}
