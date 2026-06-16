/// <reference types="astro/client" />

// What we keep in an Astro session (issue #40). The auth routes set `userId`
// on login/signup; the middleware reads it to gate protected pages.
declare namespace App {
	interface SessionData {
		userId: number;
	}

	// Request-scoped locals. The middleware copies the authenticated user's id
	// off the session onto `locals.userId` after the auth gate passes, so pages
	// and API routes read it from one typed place (Astro.locals.userId /
	// context.locals.userId) to scope per-user read state (issue #70) without
	// each re-reading the session. Optional because public allowlisted paths
	// (/public, /login, …) run with no logged-in user.
	interface Locals {
		userId?: number;
	}
}

// Worker runtime env additions beyond the generated worker-configuration.d.ts.
// AUTH_PEPPER is an optional password pepper delivered as a Worker secret
// (`wrangler secret put AUTH_PEPPER`, `.dev.vars` locally) — never in .env.
// AUTH_ALLOWED_EMAILS is the comma-separated signup allowlist (issue #76); a
// plain Worker var (the addresses aren't secret), defaulting in code to
// connor@couetil.com when unset. Set it locally in `.dev.vars`; in production
// either add a `vars` entry to wrangler.jsonc or `wrangler secret put`.
// RESEND_API_KEY is the Resend transactional-email key (issue #88), a Worker
// secret (`wrangler secret put RESEND_API_KEY`, `.dev.vars` locally) — never in
// .env. Consumed by src/lib/email.ts's sendEmail.
declare namespace Cloudflare {
	interface Env {
		AUTH_PEPPER?: string;
		AUTH_ALLOWED_EMAILS?: string;
		RESEND_API_KEY?: string;
	}
}
