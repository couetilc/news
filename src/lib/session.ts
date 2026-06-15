// Session conventions shared by the auth routes and the middleware guard.
// Astro Sessions are backed by the Cloudflare KV namespace the adapter binds as
// SESSION (see CLAUDE.md); we store just the authenticated user's id under one
// key. Keeping the key name in one place avoids drift between the writer
// (login/signup) and the reader (middleware).
export const SESSION_USER_KEY = 'userId';

// The subset of Astro's session we use, so this helper is testable without the
// full AstroSession class. Astro.session is `AstroSession | undefined`.
interface SessionLike {
	regenerate(): Promise<void>;
	set(key: string, value: number): void;
}

// Log a user in: regenerate the session id first (defense against session
// fixation on the privilege change), then record the user id. Pulled out of the
// signup/login pages so the present/absent-session branch is unit-tested rather
// than living as optional-chaining inside a .astro file. A no-op if sessions
// aren't configured (session undefined), which shouldn't happen in production
// but keeps the pages from crashing if the KV binding is ever missing.
export async function establishSession(
	session: SessionLike | undefined,
	userId: number,
): Promise<void> {
	if (!session) return;
	await session.regenerate();
	session.set(SESSION_USER_KEY, userId);
}

// The optional password pepper, a Worker secret (never in the DB or .env). Read
// off the Cloudflare env; absent locally unless set in .dev.vars. Hashing works
// without it — it's an extra mitigation against offline brute-force of a stolen
// database. Centralized here so routes don't each reach into env.
export function getPepper(env: { AUTH_PEPPER?: string }): string {
	return env.AUTH_PEPPER ?? '';
}
