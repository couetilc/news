import { normalizeEmail } from './auth';

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

// The password pepper, a Worker secret (never in the DB or .env). Read off the
// Cloudflare env; set via `wrangler secret put AUTH_PEPPER` (`.dev.vars`
// locally). Centralized here so routes don't each reach into env.
//
// FAIL CLOSED IN PRODUCTION (#189). src/lib/auth.ts documents the pepper as the
// compensating control for PBKDF2-100k (the Workers hard cap, below OWASP
// guidance). A prod deploy missing the secret would otherwise silently store and
// accept UNPEPPERED hashes — so when the pepper is absent or empty we refuse,
// failing signup/login closed rather than running without the control. Dev and
// test (`import.meta.env.PROD === false`) still allow an empty pepper for
// ergonomics. `isProduction` is a parameter (defaulting to the build-time flag)
// so both branches are unit-testable — the suite always runs non-prod.
export function getPepper(
	env: { AUTH_PEPPER?: string },
	isProduction: boolean = import.meta.env.PROD,
): string {
	const pepper = env.AUTH_PEPPER ?? '';
	if (isProduction && pepper === '') {
		throw new Error(
			'AUTH_PEPPER is required in production: it is the compensating control for ' +
				'PBKDF2-100k (see src/lib/auth.ts). Set it with `wrangler secret put AUTH_PEPPER`.',
		);
	}
	return pepper;
}

// The signup allowlist (issue #76): this is a single-user tool, so only these
// addresses may create an account. Sourced from the comma-separated
// AUTH_ALLOWED_EMAILS Worker var so it can expand later without a code change;
// defaults to just connor@couetil.com when unset. Each entry is run through the
// same normalizeEmail (trim + lowercase) used for stored emails, so the
// membership test matches however an account email was normalized at signup.
// An empty/whitespace-only var falls back to the default rather than locking
// everyone out. Centralized here so the route doesn't reach into env directly.
const DEFAULT_ALLOWED_EMAILS = ['connor@couetil.com'];

export function getAllowedEmails(env: { AUTH_ALLOWED_EMAILS?: string }): string[] {
	const configured = (env.AUTH_ALLOWED_EMAILS ?? '')
		.split(',')
		.map(normalizeEmail)
		.filter((email) => email.length > 0);
	return configured.length > 0 ? configured : [...DEFAULT_ALLOWED_EMAILS];
}
