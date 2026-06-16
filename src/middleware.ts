import { defineMiddleware } from 'astro:middleware';
import { SESSION_USER_KEY } from './lib/session';

// Auth guard (issue #40, #87). The private surface is gated by default: a
// request without a logged-in session is redirected to /login. The one
// deliberate exception is the homepage `/`, which is *session-adaptive* (#87):
// it serves the public read-only feed to anonymous visitors and the personal
// feed to logged-in ones at the same URL, so it must be reachable with or
// without a session. It still isn't a blanket public path — for a logged-in
// request the guard reads the session and exposes the user id on locals (below),
// so the page can render the personal view.
//
// PUBLIC_PATHS is the allowlist of pages that stay reachable while logged out
// *without even looking at the session*. It's an exact-match Set so adding a
// page is a one-line edit and there's no accidental prefix match. /login and
// /signup must be here or the guard would redirect them to themselves; /logout
// is here so signing out works even if the session has already lapsed; /public
// is the legacy read-only feed (issue #49), now a permanent redirect to the
// session-adaptive `/` (#87) but still allowlisted so the redirect itself is
// reachable logged out.
//
// Crucially, write routes stay OUT of both this set and the `/` exception.
// /api/read (the read/unread toggle, an Astro route under src/pages/api) is
// therefore covered by the gate: an unauthenticated POST to it — including a
// hand-crafted one from the public view of `/` — is redirected to /login (303)
// before it can touch D1, so the public homepage is read-only because the server
// refuses writes, not merely because the form isn't drawn. If a future write
// route needs to answer JSON callers rather than redirect, check the session
// inside that route instead.
const PUBLIC_PATHS = new Set(['/login', '/signup', '/logout', '/public']);

// The session-adaptive homepage (#87): reachable by anyone, but not a blanket
// public path — when a session exists the guard still surfaces the user id on
// locals so the personal feed renders. Kept separate from PUBLIC_PATHS so the
// "look at the session even though the path is reachable" behavior is explicit.
const ADAPTIVE_PATH = '/';

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

	// The session-adaptive homepage (#87) is reachable either way: an anonymous
	// request falls through to render the public read-only feed (no userId on
	// locals, so the page takes its anonymous branch); a logged-in one gets the
	// user id on locals below and renders the personal feed.
	if (pathname === ADAPTIVE_PATH && userId === undefined) return next();

	if (userId === undefined) return context.redirect('/login', 303);

	// Past the gate the request is authenticated, so expose the user id to the
	// page/API route via locals — the one place they read it to scope per-user
	// read state (issue #70), rather than each re-reading the session.
	context.locals.userId = userId;

	return next();
});
