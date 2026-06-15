import { defineMiddleware } from 'astro:middleware';
import { SESSION_USER_KEY } from './lib/session';

// Auth guard (issue #40). Every page is private by default: a request without a
// logged-in session is redirected to /login. This is the single gate in front of
// the otherwise-global homepage data, the practical v1 for a single-user tool.
//
// PUBLIC_PATHS is the allowlist of pages that stay reachable while logged out.
// It's an exact-match Set so adding a page (e.g. issue #49's coming public page)
// is a one-line edit and there's no accidental prefix match. /login and /signup
// must be here or the guard would redirect them to themselves; /logout is here
// so signing out works even if the session has already lapsed.
//
// Astro runs middleware only for routes it owns, so static assets and the
// /api/* endpoints served by the worker aren't gated here. /api/read (the
// read/unread toggle) is reached only from the already-guarded homepage. If a
// future API route needs gating, check the session inside that route — mixing
// API auth into this page-redirect guard would send JSON callers an HTML
// redirect.
const PUBLIC_PATHS = new Set(['/login', '/signup', '/logout']);

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname } = context.url;
	if (PUBLIC_PATHS.has(pathname)) return next();

	const userId = await context.session?.get(SESSION_USER_KEY);
	if (userId === undefined) return context.redirect('/login', 303);

	return next();
});
