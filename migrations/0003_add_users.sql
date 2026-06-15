-- User accounts (issue #40). Auth only: the homepage's existing global data
-- (items.read_at) stays shared for now — true per-user read state is a
-- follow-up (a join table keyed by user id) before opening signup beyond one
-- account. A logged-in session is the gate; this table holds the credential.
--
-- password_hash is never a raw password: it's a self-describing PBKDF2 record
-- "pbkdf2$<iterations>$<salt-b64>$<hash-b64>" (see src/lib/auth.ts), so the
-- iteration count and per-user random salt travel with the digest and can be
-- raised later without a migration.
CREATE TABLE users (
	id            INTEGER PRIMARY KEY,
	email         TEXT UNIQUE NOT NULL,
	password_hash TEXT NOT NULL,
	-- Unix seconds UTC at account creation.
	created_at    INTEGER NOT NULL
);
