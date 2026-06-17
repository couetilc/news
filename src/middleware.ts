import { defineMiddleware } from 'astro:middleware';
import { SESSION_USER_KEY } from './lib/session';

// Auth guard (issue #40, #87, #150). The private surface is gated by default: a
// request without a logged-in session is redirected to /login. The deliberate
// exceptions are the *session-adaptive* paths — `/`, `/login`, `/signup` — which
// are reachable with or without a session, but still aren't blanket public paths:
// the guard reads the session for them and, when one exists, exposes the user id
// on locals (below) so each page can adapt to the real auth state.
//
// PUBLIC_PATHS is the allowlist of pages that stay reachable while logged out
// *without even looking at the session*. It's an exact-match Set so adding a
// page is a one-line edit and there's no accidental prefix match. /logout is
// here so signing out works even if the session has already lapsed; /public is
// the legacy read-only feed (issue #49), now a permanent redirect to the
// session-adaptive `/` (#87) but still allowlisted so the redirect itself is
// reachable logged out. /status is the public operational page (#272): it's
// `prerender = true` (deploy metadata only, no per-user state), so it MUST be
// allowlisted here — Astro runs this middleware while prerendering at build
// time, where there is no session, so without the allowlist the build-time
// render takes the unauthenticated branch below and bakes a redirect-to-/login
// stub into the static /status/index.html. That stub then bounces EVERY
// visitor (anonymous and logged-in alike, since the worker never runs for a
// prerendered asset at request time) to /login — the #287 regression. None of
// these pages render the session-aware masthead in a state that needs the user
// id, so none reads the session.
//
// Crucially, write routes stay OUT of both this set and the adaptive set.
// /api/read (the read/unread toggle, an Astro route under src/pages/api) is
// therefore covered by the gate: an unauthenticated POST to it — including a
// hand-crafted one from the public view of `/` — is redirected to /login (303)
// before it can touch D1, so the public homepage is read-only because the server
// refuses writes, not merely because the form isn't drawn. If a future write
// route needs to answer JSON callers rather than redirect, check the session
// inside that route instead.
const PUBLIC_PATHS = new Set(['/logout', '/public', '/status']);

// Session-adaptive paths: reachable by anyone (logged in or out), but not blanket
// public paths — the guard reads the session for them and, when one exists,
// surfaces the user id on locals so each page renders the matching state. Kept as
// an explicit Set, separate from PUBLIC_PATHS, so the "look at the session even
// though the path is reachable" behavior is deliberate, not a prefix accident.
//
// - `/` (#87): serves the public read-only feed to anonymous visitors and the
//   personal feed to logged-in ones at the same URL.
// - `/login`, `/signup` (#150): the auth forms must stay reachable logged out, but
//   the shared layout's masthead carries the session control (#128). If the guard
//   skipped the session here (the old PUBLIC_PATHS behavior), an already logged-in
//   visitor hitting /login would render the anonymous "Log in" control — a
//   self-link on /login — instead of "Sign out". Reading the session lets the
//   masthead reflect the real state while anonymous requests still fall through to
//   the form.
const ADAPTIVE_PATHS = new Set(['/', '/login', '/signup']);

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

	// The session-adaptive paths (#87, #150) are reachable either way: an anonymous
	// request falls through to render its logged-out view (no userId on locals, so
	// the page/masthead takes its anonymous branch — the public read-only feed on
	// `/`, the auth form on /login and /signup); a logged-in one gets the user id on
	// locals below so the page and the shared masthead render the signed-in state.
	if (ADAPTIVE_PATHS.has(pathname) && userId === undefined) return next();

	if (userId === undefined) return context.redirect('/login', 303);

	// Past the gate the request is authenticated, so expose the user id to the
	// page/API route via locals — the one place they read it to scope per-user
	// read state (issue #70), rather than each re-reading the session.
	context.locals.userId = userId;

	return next();
});
