import { describe, expect, it, vi } from 'vitest';
import { onRequest } from '../src/middleware';
import { SESSION_USER_KEY } from '../src/lib/session';

// The guard is a pure function of (context, next), so we drive it directly with
// a minimal fake context rather than booting a server. `next` and `redirect` are
// distinct sentinels so we can tell which path the guard took.
const NEXT = new Response('next');
const next = vi.fn(async () => NEXT);

const run = (
	path: string,
	session: { get: (k: string) => Promise<unknown> } | undefined,
) => {
	next.mockClear();
	const redirect = vi.fn(
		(location: string, status: number) =>
			new Response(null, { status, headers: { Location: location } }),
	);
	// `locals` mirrors the request-scoped object Astro injects; the guard writes
	// the authenticated user id onto it (#70), so tests can read it back.
	const locals: { userId?: number } = {};
	const context = {
		url: new URL(`http://news.test${path}`),
		session,
		redirect,
		locals,
	};
	return { promise: onRequest(context as never, next), redirect, locals };
};

const sessionWith = (userId: number | undefined) => ({
	get: vi.fn(async (key: string) => (key === SESSION_USER_KEY ? userId : undefined)),
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

	it('redirects an unauthenticated request to /login', async () => {
		const { promise, redirect } = run('/', sessionWith(undefined));
		const res = await promise;
		expect(redirect).toHaveBeenCalledWith('/login', 303);
		expect(res.headers.get('Location')).toBe('/login');
		expect(next).not.toHaveBeenCalled();
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

	it('treats a missing session object the same as unauthenticated', async () => {
		// session is undefined (e.g. sessions misconfigured): no user → redirect.
		const { promise, redirect } = run('/', undefined);
		await promise;
		expect(redirect).toHaveBeenCalledWith('/login', 303);
	});
});
