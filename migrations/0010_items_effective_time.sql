-- Matches the digest cursor and ordering, including undated articles.
-- Query plans: experiments/401/query-plan.txt.
CREATE INDEX items_by_effective_time
ON items (COALESCE(published_at, fetched_at) DESC, id DESC);
