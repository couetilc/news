import { defineMiddleware } from 'astro:middleware';
import { SESSION_USER_KEY } from './lib/session';

// Auth guard (issue #40). Every page is private by default: a request without a
// logged-in session is redirected to /login. This is the single gate in front of
// the otherwise-global homepage data, the practical v1 for a single-user tool.
//
// PUBLIC_PATHS is the allowlist of pages that stay reachable while logged out.
// It's an exact-match Set so adding a page is a one-line edit and there's no
// accidental prefix match. /login and /signup must be here or the guard would
// redirect them to themselves; /logout is here so signing out works even if the
// session has already lapsed; /public is the read-only feed (issue #49) for
// drive-by visitors who aren't Connor.
//
// Crucially, write routes stay OUT of this set. /api/read (the read/unread
// toggle, an Astro route under src/pages/api) is therefore covered by this
// guard: an unauthenticated POST to it — including a hand-crafted one from the
// public page — is redirected to /login (303) before it can touch D1, so the
// public page is read-only because the server refuses writes, not merely because
// the form isn't drawn. If a future write route needs to answer JSON callers
// rather than redirect, check the session inside that route instead.
const PUBLIC_PATHS = new Set(['/login', '/signup', '/logout', '/public']);

// Astro's default `trailingSlash: "ignore"` serves both `/public` and `/public/`
// (and `/signup` vs `/signup/`, etc.) as the same route, but leaves the trailing
// slash on `context.url.pathname` before user middleware runs. The allowlist is
// exact-match, so without normalizing here `/public/` would miss it and — worse —
// a POST to `/signup/` would be 303-redirected to /login with its form data
// silently dropped (issues #81, #95). Strip a single trailing slash before the
// lookup, but never reduce the root `/` to an empty string (which matches nothing).
const normalizePath = (pathname: string) =>
	pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;

export const onRequest = defineMiddleware(async (context, next) => {
	const pathname = normalizePath(context.url.pathname);
	if (PUBLIC_PATHS.has(pathname)) return next();

	const userId = await context.session?.get(SESSION_USER_KEY);
	if (userId === undefined) return context.redirect('/login', 303);

	// Past the gate the request is authenticated, so expose the user id to the
	// page/API route via locals — the one place they read it to scope per-user
	// read state (issue #70), rather than each re-reading the session.
	context.locals.userId = userId;

	return next();
});
