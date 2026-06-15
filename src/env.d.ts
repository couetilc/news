/// <reference types="astro/client" />

// What we keep in an Astro session (issue #40). The auth routes set `userId`
// on login/signup; the middleware reads it to gate protected pages.
declare namespace App {
	interface SessionData {
		userId: number;
	}
}

// Worker runtime env additions beyond the generated worker-configuration.d.ts.
// AUTH_PEPPER is an optional password pepper delivered as a Worker secret
// (`wrangler secret put AUTH_PEPPER`, `.dev.vars` locally) — never in .env.
declare namespace Cloudflare {
	interface Env {
		AUTH_PEPPER?: string;
	}
}
