-- Per-user read state (issue #70). Auth (#40) shipped single-user: read state
-- lived in the global items.read_at column, which a second account would share.
-- This join table makes read/unread state per-user so two accounts have wholly
-- independent unread feeds and "Read" sections.
--
-- One row per (user, item) the user has marked read; absence of a row = unread
-- for that user. read_at is the unix-seconds timestamp at the moment they marked
-- it (same meaning the old global column carried, now scoped to a user). The
-- composite PRIMARY KEY (user_id, item_id) makes "mark read" idempotent via
-- INSERT ... ON CONFLICT and gives the per-user lookups their index for free.
--
-- Backfill decision: START FRESH — do NOT copy the old global items.read_at into
-- any user's rows. Production has zero users today (the users table from #0003 is
-- empty; this work lands before a second account is created, per #70), so there
-- is no "first user" whose history the global column represents — backfilling
-- would be guessing an owner. The legacy items.read_at column is intentionally
-- left in place: the public read-only feed (#49) still SELECTs it via listItems()
-- (and renders everything as unread regardless), so dropping it is out of scope
-- here; it is simply no longer the source of truth for a logged-in reader.
CREATE TABLE item_reads (
	user_id INTEGER NOT NULL,
	item_id INTEGER NOT NULL,
	-- Unix seconds UTC when this user marked this item read.
	read_at INTEGER NOT NULL,
	PRIMARY KEY (user_id, item_id)
);
