-- Coordinate infrequent refresh attempts across Worker instances without
-- storing bearer session IDs in D1. The application keeps only SHA-256 hashes.
CREATE TABLE session_refresh_claims (
	session_hash TEXT PRIMARY KEY,
	claimed_at INTEGER NOT NULL
);
CREATE INDEX session_refresh_claims_by_time ON session_refresh_claims (claimed_at);
