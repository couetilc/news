-- Add a second dedupe key on (source, url) (#191). The original key is
-- UNIQUE (source, guid) (migrations/0001_init.sql), and parseRss20 derives
-- guid = <guid> ?? <link>. The NVIDIA WordPress blog feed exposed the failure:
-- the same post was stored twice under source=nvidia because its <guid> drifted
-- between fetches (the WordPress `?p=<id>` guid one time, the <link> permalink
-- fallback the next), so (source, guid) saw two distinct keys for one article.
-- Both rows always share the same canonical `url`, so a UNIQUE (source, url)
-- index catches that cross-guid duplicate regardless of guid drift.
--
-- SQLite/D1 cannot ALTER TABLE ADD CONSTRAINT, and CREATE UNIQUE INDEX fails if
-- duplicate (source, url) rows already exist — so existing dupes MUST be deleted
-- before the index is created. The order below is load-bearing:
--   1. re-point read marks off every doomed dupe onto the surviving row,
--   2. delete the dupe rows,
--   3. delete any now-orphaned read marks,
--   4. create the UNIQUE index.
--
-- NOTE: D1 forbids CREATE TEMP TABLE (SQLITE_AUTH), so the survivor is computed
-- inline as MIN(id) per (source, url) group via correlated subqueries.
--
-- Survivor choice preserves read state. Items carry per-user read marks in
-- item_reads (migrations/0004), and #139/#140 reject writes that would orphan a
-- read mark. We keep the LOWEST id per (source, url) group and, before deleting
-- the others, RE-POINT their read marks onto that survivor (step 1). Because
-- every dropped dupe's marks are copied forward first, which row we keep can't
-- lose anyone's read state — so the simplest deterministic rule (lowest id)
-- suffices; no need to prefer the most-read row. ON CONFLICT keeps the
-- survivor's existing (user, item) mark, since a user can't read one article
-- twice.

-- 1. Copy read marks from each doomed dupe (id above its group's MIN) onto the
--    survivor (the group's MIN id). ON CONFLICT keeps any mark the survivor
--    already has for that user.
INSERT INTO item_reads (user_id, item_id, read_at)
SELECT r.user_id,
       (SELECT MIN(j.id) FROM items j WHERE j.source = d.source AND j.url = d.url),
       r.read_at
FROM item_reads r
JOIN items d ON d.id = r.item_id
WHERE d.id > (SELECT MIN(j.id) FROM items j WHERE j.source = d.source AND j.url = d.url)
ON CONFLICT(user_id, item_id) DO NOTHING;

-- 2. Delete every duplicate item row (anything above its group's MIN id).
DELETE FROM items
WHERE id > (SELECT MIN(j.id) FROM items j WHERE j.source = items.source AND j.url = items.url);

-- 3. Drop any read marks now pointing at a deleted item (item_reads has no FK,
--    so they don't cascade; step 1 already copied the useful ones forward).
DELETE FROM item_reads WHERE item_id NOT IN (SELECT id FROM items);

-- 4. The new dedupe key. With every duplicate removed, this now succeeds; future
--    inserts colliding on (source, url) are ignored by insertItems' ON CONFLICT.
CREATE UNIQUE INDEX items_source_url ON items (source, url);
