-- Backfill legacy global read marks into the per-user item_reads table (#139).
--
-- 0004 deliberately started item_reads empty on the stated assumption that
-- production had zero users, so there was no "first user" to attribute the old
-- global items.read_at marks to. A post-merge read-only D1 spot-check showed
-- that assumption was already false: production has exactly ONE user, four rows
-- with items.read_at IS NOT NULL, and zero item_reads — so the merged homepage
-- (which reads state only from item_reads) silently showed those four read items
-- as unread. This is the recoverable repair.
--
-- Deterministic ONLY at exactly one user: with a single account, every legacy
-- global read mark unambiguously belongs to that account, so we copy each
-- items.read_at IS NOT NULL row to (sole user id, item id, read_at). The
-- `(SELECT COUNT(*) FROM users) = 1` guard makes this a no-op when there are
-- zero users (nothing to attribute) or more than one (no safe owner to guess) —
-- so re-running against any future multi-user database changes nothing. The sole
-- user's id is read via the scalar subquery (only meaningful when the count is 1).
--
-- ON CONFLICT DO NOTHING keeps it idempotent and safe to re-run: a (user, item)
-- the user already marked read via the app keeps its existing item_reads.read_at
-- and is never overwritten by the legacy value. The legacy items.read_at column
-- is left untouched (still SELECTed by the public read-only feed via listItems).
INSERT INTO item_reads (user_id, item_id, read_at)
SELECT (SELECT id FROM users), i.id, i.read_at
FROM items i
WHERE i.read_at IS NOT NULL
  AND (SELECT COUNT(*) FROM users) = 1
ON CONFLICT(user_id, item_id) DO NOTHING;
