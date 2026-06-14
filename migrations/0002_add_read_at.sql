-- Read/unread state for the homepage digest. The feed is one chronological
-- column; marking an item read drops it out of the live feed and into a second
-- "Read" section below, still sorted newest-first. NULL = unread; set to the
-- unix-seconds timestamp at the moment the reader marks it read.
ALTER TABLE items ADD COLUMN read_at INTEGER;
