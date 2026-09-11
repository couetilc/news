-- Durable current feed health, separate from legacy validator/scheduling state.
CREATE TABLE feed_health (
  feed TEXT PRIMARY KEY REFERENCES feeds(feed) ON DELETE CASCADE,
  last_attempt_at INTEGER,
  last_finished_at INTEGER,
  response_status INTEGER,
  last_success_at INTEGER,
  last_clean_at INTEGER,
  last_error TEXT,
  last_error_at INTEGER,
  error_resolved_at INTEGER,
  last_anomaly TEXT,
  last_anomaly_at INTEGER,
  anomaly_resolved_at INTEGER
);

-- Start and completion are separate writes: an interrupted invocation remains
-- visible. Run identities avoid an older invocation overwriting a newer one.
CREATE TABLE ingest_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  polled INTEGER NOT NULL DEFAULT 0,
  failed_feeds INTEGER NOT NULL DEFAULT 0,
  anomalous_feeds INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
