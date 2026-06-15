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
	const context = {
		url: new URL(`http://news.test${path}`),
		session,
		redirect,
	};
	return { promise: onRequest(context as never, next), redirect };
};

const sessionWith = (userId: number | undefined) => ({
	get: vi.fn(async (key: string) => (key === SESSION_USER_KEY ? userId : undefined)),
});

describe('auth middleware', () => {
	it('lets public paths through without checking the session', async () => {
		for (const path of ['/login', '/signup', '/logout']) {
			const { promise } = run(path, undefined);
			expect(await promise).toBe(NEXT);
		}
		expect(next).toHaveBeenCalled();
	});

	it('redirects an unauthenticated request to /login', async () => {
		const { promise, redirect } = run('/', sessionWith(undefined));
		const res = await promise;
		expect(redirect).toHaveBeenCalledWith('/login', 303);
		expect(res.headers.get('Location')).toBe('/login');
		expect(next).not.toHaveBeenCalled();
	});

	it('lets an authenticated request through to the page', async () => {
		const { promise } = run('/', sessionWith(42));
		expect(await promise).toBe(NEXT);
		expect(next).toHaveBeenCalled();
	});

	it('treats a missing session object the same as unauthenticated', async () => {
		// session is undefined (e.g. sessions misconfigured): no user → redirect.
		const { promise, redirect } = run('/', undefined);
		await promise;
		expect(redirect).toHaveBeenCalledWith('/login', 303);
	});
});
