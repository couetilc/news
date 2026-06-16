import { describe, expect, it, vi } from 'vitest';
import { isCrossSiteFormPost, onRequest } from '../src/middleware';
import { SESSION_USER_KEY } from '../src/lib/session';

// The guard is a pure function of (context, next), so we drive it directly with
// a minimal fake context rather than booting a server. `next`, `redirect`, and
// `rewrite` are distinct sentinels so we can tell which path the guard took.
const NEXT = new Response('next');
const next = vi.fn(async () => NEXT);

const run = (
	path: string,
	session: { get: (k: string) => Promise<unknown> } | undefined,
	// A same-origin GET by default — the cross-site write guard is exercised by
	// the dedicated cases below, which pass an explicit request.
	request?: Request,
) => {
	next.mockClear();
	const redirect = vi.fn(
		(location: string, status: number) =>
			new Response(null, { status, headers: { Location: location } }),
	);
	const url = new URL(`http://news.test${path}`);
	// The Astro origin-check default rewrite target renders /403.astro; here the
	// rewrite is a sentinel so we can assert the guard chose it.
	const rewrite = vi.fn(
		(location: string) => new Response(`rewrite:${location}`, { status: 403 }),
	);
	// `locals` mirrors the request-scoped object Astro injects; the guard writes
	// the authenticated user id onto it (#70), so tests can read it back.
	const locals: { userId?: number } = {};
	const context = {
		url,
		request: request ?? new Request(url, { method: 'GET' }),
		session,
		redirect,
		rewrite,
		locals,
	};
	return { promise: onRequest(context as never, next), redirect, rewrite, locals };
};

// A cross-site form POST: an unsafe method, a form content-type, and an `Origin`
// header that does NOT match the request URL's origin (the canonical CSRF shape).
const crossSitePost = (path: string) =>
	new Request(`http://news.test${path}`, {
		method: 'POST',
		headers: { origin: 'http://evil.test', 'content-type': 'application/x-www-form-urlencoded' },
		body: 'email=a@b.co&password=long-enough-pw',
	});

const sessionWith = (userId: number | undefined) => ({
	get: vi.fn(async (key: string) => (key === SESSION_USER_KEY ? userId : undefined)),
});

describe('isCrossSiteFormPost (CSRF same-origin check, #95)', () => {
	const post = (path: string, headers: Record<string, string>) =>
		new Request(`http://news.test${path}`, { method: 'POST', headers, body: 'x=1' });
	const urlFor = (path: string) => new URL(`http://news.test${path}`);

	it('rejects a cross-origin form POST', () => {
		const req = post('/signup', {
			origin: 'http://evil.test',
			'content-type': 'application/x-www-form-urlencoded',
		});
		expect(isCrossSiteFormPost(req, urlFor('/signup'))).toBe(true);
	});

	it('rejects a cross-origin write with no content-type (bodyless/originless)', () => {
		const req = post('/signup', { origin: 'http://evil.test' });
		expect(isCrossSiteFormPost(req, urlFor('/signup'))).toBe(true);
	});

	it('rejects a multipart cross-origin POST regardless of header casing', () => {
		const req = post('/signup', {
			origin: 'http://evil.test',
			'content-type': 'MULTIPART/FORM-DATA; boundary=abc',
		});
		expect(isCrossSiteFormPost(req, urlFor('/signup'))).toBe(true);
	});

	it('allows a same-origin form POST (the real signup/login submit)', () => {
		const req = post('/signup', {
			origin: 'http://news.test',
			'content-type': 'application/x-www-form-urlencoded',
		});
		expect(isCrossSiteFormPost(req, urlFor('/signup'))).toBe(false);
	});

	it('allows a cross-origin POST with a non-form content-type (e.g. JSON API)', () => {
		// Matches Astro's scope: only form-like content-types are CSRF-guarded, so a
		// CORS-negotiated JSON caller isn't caught by this same-origin check.
		const req = post('/api/thing', {
			origin: 'http://evil.test',
			'content-type': 'application/json',
		});
		expect(isCrossSiteFormPost(req, urlFor('/api/thing'))).toBe(false);
	});

	it('allows any safe method (GET/HEAD/OPTIONS) cross-origin', () => {
		for (const method of ['GET', 'HEAD', 'OPTIONS']) {
			const req = new Request('http://news.test/', {
				method,
				headers: { origin: 'http://evil.test' },
			});
			expect(isCrossSiteFormPost(req, urlFor('/'))).toBe(false);
		}
	});
});

describe('cross-site write guard in the middleware (#95)', () => {
	it('rewrites a forbidden cross-site form POST to the styled /403 page', async () => {
		// A cross-origin POST to /signup is rejected with the in-voice 403 *before*
		// the auth guard runs — so the reader sees the styled page, not a /login
		// redirect and not Astro's bare plaintext default.
		const { promise, rewrite, redirect } = run('/signup', undefined, crossSitePost('/signup'));
		const res = await promise;
		expect(rewrite).toHaveBeenCalledWith('/403');
		expect(res.status).toBe(403);
		// It short-circuits: neither the public-path passthrough nor the redirect ran.
		expect(redirect).not.toHaveBeenCalled();
		expect(next).not.toHaveBeenCalled();
	});

	it('rewrites even a cross-site POST to a gated write route to /403, not /login', async () => {
		// The origin check precedes the auth guard, so a forged cross-site POST to
		// /api/read gets the 403 page rather than the unauthenticated /login redirect.
		const { promise, rewrite, redirect } = run(
			'/api/read',
			sessionWith(undefined),
			crossSitePost('/api/read'),
		);
		await promise;
		expect(rewrite).toHaveBeenCalledWith('/403');
		expect(redirect).not.toHaveBeenCalled();
	});

	it('lets a same-origin POST to /signup through to the route (real submit)', async () => {
		// The genuine browser submit always carries a matching Origin, so it sails
		// past the guard into the public allowlist — no 403, no rewrite.
		const sameOrigin = new Request('http://news.test/signup', {
			method: 'POST',
			headers: { origin: 'http://news.test', 'content-type': 'application/x-www-form-urlencoded' },
			body: 'email=a@b.co&password=long-enough-pw',
		});
		const { promise, rewrite } = run('/signup', undefined, sameOrigin);
		expect(await promise).toBe(NEXT);
		expect(rewrite).not.toHaveBeenCalled();
	});

	it('does NOT re-rewrite the /403 target itself (loop guard)', async () => {
		// The rewrite re-runs this middleware against /403 while preserving the
		// original cross-site POST, so the rewrite target is exempted from the
		// check; otherwise it would rewrite to /403 again forever (HTTP 508). It
		// falls through the public allowlist (/403 is allowlisted) to next() so the
		// page renders.
		const { promise, rewrite } = run('/403', undefined, crossSitePost('/403'));
		expect(await promise).toBe(NEXT);
		expect(rewrite).not.toHaveBeenCalled();
	});
});

describe('auth middleware', () => {
	it('lets public paths through without checking the session', async () => {
		// /public is the read-only feed (issue #49) — reachable logged out.
		for (const path of ['/login', '/signup', '/logout', '/public']) {
			const { promise } = run(path, undefined);
			expect(await promise).toBe(NEXT);
		}
		expect(next).toHaveBeenCalled();
	});

	it('lets the trailing-slash variants of public paths through logged out', async () => {
		// Astro's `trailingSlash: "ignore"` serves `/public` and `/public/` as the
		// same route but leaves the slash on context.url.pathname; the guard
		// normalizes it before the exact-match lookup (issues #81, #95), so the
		// slash forms reach the same allowlist as their no-slash forms.
		for (const path of ['/login/', '/signup/', '/logout/', '/public/']) {
			const { promise } = run(path, undefined);
			expect(await promise).toBe(NEXT);
		}
		expect(next).toHaveBeenCalled();
	});

	it('does not drop a POST to a trailing-slash auth route (issue #95)', async () => {
		// The trailing-slash bug previously 303-redirected `/signup/` to /login,
		// dropping the submitted form data so no account was ever created. After
		// normalization the request passes straight through to the route, which is
		// what lets the POST body survive — verified here without booting a server.
		const { promise, redirect } = run('/signup/', undefined);
		expect(await promise).toBe(NEXT);
		expect(redirect).not.toHaveBeenCalled();
	});

	it('redirects an unauthenticated request for a gated page to /login', async () => {
		// A private page that is neither allowlisted nor the adaptive homepage.
		const { promise, redirect } = run('/settings', sessionWith(undefined));
		const res = await promise;
		expect(redirect).toHaveBeenCalledWith('/login', 303);
		expect(res.headers.get('Location')).toBe('/login');
		expect(next).not.toHaveBeenCalled();
	});

	it('lets an anonymous request through to the session-adaptive homepage (#87)', async () => {
		// `/` is no longer redirected to /login: it serves the public read-only
		// feed to anonymous visitors. The guard passes it through *without* setting
		// locals.userId, so the page takes its anonymous branch.
		const { promise, redirect, locals } = run('/', sessionWith(undefined));
		expect(await promise).toBe(NEXT);
		expect(redirect).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalled();
		expect(locals.userId).toBeUndefined();
	});

	it('lets an anonymous trailing-slash homepage through too', async () => {
		// `/` has no slash to strip, but a defensive normalize check: the root is
		// never reduced to an empty string, so it still matches the adaptive path.
		const { promise, redirect } = run('/', undefined);
		expect(await promise).toBe(NEXT);
		expect(redirect).not.toHaveBeenCalled();
	});

	it('still guards a private trailing-slash path after normalizing', async () => {
		// Normalization strips the slash but must not turn a private route public:
		// `/api/read/` normalizes to `/api/read`, which is not in the allowlist, so
		// an anonymous request is still redirected to /login.
		const { promise, redirect } = run('/api/read/', sessionWith(undefined));
		const res = await promise;
		expect(redirect).toHaveBeenCalledWith('/login', 303);
		expect(res.status).toBe(303);
		expect(next).not.toHaveBeenCalled();
	});

	it('rejects an unauthenticated POST to the write endpoint server-side', async () => {
		// /api/read (the read/unread write) is deliberately NOT a public path, so a
		// forged anonymous POST — e.g. from the public read-only feed — is redirected
		// to /login by the guard before the route runs, never reaching D1. The page
		// is read-only because the server refuses writes, not because the form is
		// merely hidden.
		const { promise, redirect } = run('/api/read', sessionWith(undefined));
		const res = await promise;
		expect(redirect).toHaveBeenCalledWith('/login', 303);
		expect(res.status).toBe(303);
		expect(res.headers.get('Location')).toBe('/login');
		expect(next).not.toHaveBeenCalled();
	});

	it('lets an authenticated request through to the page', async () => {
		const { promise } = run('/', sessionWith(42));
		expect(await promise).toBe(NEXT);
		expect(next).toHaveBeenCalled();
	});

	it('exposes the authenticated user id on locals for per-user read state (#70)', async () => {
		// Downstream pages/routes scope read state to locals.userId; the guard is
		// the one place that copies it off the session after the auth check.
		const { promise, locals } = run('/', sessionWith(42));
		await promise;
		expect(locals.userId).toBe(42);
	});

	it('treats a missing session object the same as unauthenticated on a gated page', async () => {
		// session is undefined (e.g. sessions misconfigured): no user → redirect.
		// Use a gated path; `/` would now pass through to its anonymous view (#87).
		const { promise, redirect } = run('/settings', undefined);
		await promise;
		expect(redirect).toHaveBeenCalledWith('/login', 303);
	});
});
