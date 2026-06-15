// User-account D1 access (issue #40). Mirrors src/ingest/db.ts: thin functions
// over a D1Database, no ORM. The schema lives in migrations/0003_add_users.sql.

// A row of the users table.
export interface UserRow {
	id: number;
	email: string;
	password_hash: string;
	created_at: number;
}

// Insert a new user and return its row. The caller is responsible for hashing
// the password (src/lib/auth.ts) and normalizing the email first. A duplicate
// email throws (the UNIQUE constraint) — signup catches that and reports it as a
// "taken" error rather than letting it 500.
export async function createUser(
	db: D1Database,
	email: string,
	passwordHash: string,
	createdAt: number,
): Promise<UserRow> {
	const row = await db
		.prepare(
			`INSERT INTO users (email, password_hash, created_at)
			 VALUES (?, ?, ?)
			 RETURNING id, email, password_hash, created_at`,
		)
		.bind(email, passwordHash, createdAt)
		.first<UserRow>();
	// RETURNING always yields a row on a successful insert; the non-null
	// assertion documents that and keeps the return type clean.
	return row!;
}

// Look up a user by their (already-normalized) email. Returns null when no such
// account exists — login treats that the same as a wrong password so the form
// never reveals which emails are registered.
export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
	return db
		.prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?')
		.bind(email)
		.first<UserRow>();
}
