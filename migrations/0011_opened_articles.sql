-- Separate an opened article from a manual mark-read/swipe. Keep the existing
-- Recently viewed history as displayed before this change; future dismissals
-- no longer replace it. All existing item IDs and read timestamps are retained.
ALTER TABLE item_reads ADD COLUMN opened_at INTEGER;
UPDATE item_reads SET opened_at = read_at;
