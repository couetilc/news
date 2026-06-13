-- Feed items, deduplicated by (source, guid). Source/feed definitions live in
-- code (src/ingest/sources.ts); these tables hold only fetched data and state.
CREATE TABLE items (
	id           INTEGER PRIMARY KEY,
	source       TEXT NOT NULL,
	guid         TEXT NOT NULL,
	url          TEXT NOT NULL,
	title        TEXT NOT NULL,
	summary      TEXT,
	content_html TEXT,
	-- Unix seconds UTC, normalized at ingest; null when the feed omits a date.
	published_at INTEGER,
	fetched_at   INTEGER NOT NULL,
	UNIQUE (source, guid)
);

CREATE INDEX items_by_time ON items (published_at DESC);

-- Per-endpoint fetch state; one source may poll several endpoints.
CREATE TABLE feeds (
	feed          TEXT PRIMARY KEY,
	source        TEXT NOT NULL,
	etag          TEXT,
	last_modified TEXT,
	next_poll_at  INTEGER NOT NULL DEFAULT 0,
	last_status   INTEGER,
	failure_count INTEGER NOT NULL DEFAULT 0,
	-- Per-source quirk state (e.g. a burst-poll window around earnings dates).
	state_json    TEXT
);
