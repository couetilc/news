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
// reachable logged out. /403 is the in-voice cross-site rejection page (#95):
// the cross-site guard below `rewrite`s to it, and a rewrite re-runs this
// middleware against `/403`, so it must be reachable without a session or the
// guard would redirect the rejection page itself to /login.
//
// Crucially, write routes stay OUT of both this set and the `/` exception.
// /api/read (the read/unread toggle, an Astro route under src/pages/api) is
// therefore covered by the gate: an unauthenticated POST to it — including a
// hand-crafted one from the public view of `/` — is redirected to /login (303)
// before it can touch D1, so the public homepage is read-only because the server
// refuses writes, not merely because the form isn't drawn. If a future write
// route needs to answer JSON callers rather than redirect, check the session
// inside that route instead.
const PUBLIC_PATHS = new Set(['/login', '/signup', '/logout', '/public', '/403']);

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

// Same-origin write guard (issue #95), reimplemented from Astro's built-in
// `security.checkOrigin` (turned OFF in astro.config.mjs) so we own the
// response. Astro's default returns an unstyled plaintext "Cross-site POST form
// submissions are forbidden" 403; doing the check here lets us rewrite to the
// in-voice src/pages/403.astro instead. The logic mirrors Astro's exactly:
// only unsafe methods (anything but GET/HEAD/OPTIONS) carrying a *form*
// content-type (or none at all — a bodyless cross-site write) are rejected when
// the `Origin` header doesn't match the request URL's origin. A same-origin
// browser form POST always sends a matching `Origin`, so the real signup/login
// flow is unaffected; only a genuine cross-site/originless submission trips it.
//
// Scoping to form content-types (matching Astro) means JSON/API callers that opt
// into CORS aren't caught here. We have none today, but keeping the scope
// identical avoids surprising a future fetch() endpoint.
const FORM_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'];
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const hasFormLikeContentType = (contentType: string | null) =>
	contentType !== null && FORM_CONTENT_TYPES.some((t) => contentType.toLowerCase().includes(t));

export const isCrossSiteFormPost = (request: Request, url: URL): boolean => {
	if (SAFE_METHODS.includes(request.method)) return false;
	const isSameOrigin = request.headers.get('origin') === url.origin;
	if (isSameOrigin) return false;
	// Unsafe method + cross-origin: reject a form-like body, or a bodyless write
	// with no content-type at all (Astro treats the missing header as suspect too).
	const contentType = request.headers.get('content-type');
	return contentType === null || hasFormLikeContentType(contentType);
};

// The internal route the cross-site rejection rewrites to (src/pages/403.astro).
// A `rewrite` re-runs this middleware against the target path while *preserving
// the original request* — same POST method, same cross-site Origin — so without
// exempting the target here the check would re-trip on /403 and loop forever
// (HTTP 508). The error page is our own trusted route, so it's never CSRF-checked.
const FORBIDDEN_PATH = '/403';

export const onRequest = defineMiddleware(async (context, next) => {
	const pathname = normalizePath(context.url.pathname);

	// Reject a forbidden cross-site write before the auth guard so the reader gets
	// the styled 403 (not a /login redirect). The rewrite renders /403.astro,
	// which sets the 403 status itself. Skip the rewrite target itself to avoid an
	// infinite rewrite loop (see FORBIDDEN_PATH).
	if (pathname !== FORBIDDEN_PATH && isCrossSiteFormPost(context.request, context.url)) {
		return context.rewrite(FORBIDDEN_PATH);
	}

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
