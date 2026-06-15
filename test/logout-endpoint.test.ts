import { describe, expect, it, vi } from 'vitest';
import { POST } from '../src/pages/logout';
import { establishSession, getPepper, SESSION_USER_KEY } from '../src/lib/session';

// Drive /logout the way the homepage form does: a POST with a stub `session` and
// `redirect`. No D1 or crypto, but it lives in the workers project alongside the
// other endpoint tests.
describe('POST /logout', () => {
	it('destroys the session and 303-redirects to /login', () => {
		const destroy = vi.fn();
		const redirect = vi.fn(
			(path: string, status: number) =>
				new Response(null, { status, headers: { Location: path } }),
		);
		const res = POST({ session: { destroy }, redirect } as never);
		expect(destroy).toHaveBeenCalledOnce();
		expect(res.status).toBe(303);
		expect(res.headers.get('Location')).toBe('/login');
	});

	it('still redirects when there is no session to destroy', () => {
		const redirect = vi.fn(
			(path: string, status: number) =>
				new Response(null, { status, headers: { Location: path } }),
		);
		const res = POST({ session: undefined, redirect } as never);
		expect(res.headers.get('Location')).toBe('/login');
	});
});

describe('session helpers', () => {
	it('exposes a stable session key', () => {
		expect(SESSION_USER_KEY).toBe('userId');
	});

	it('reads AUTH_PEPPER from env, defaulting to empty string', () => {
		expect(getPepper({ AUTH_PEPPER: 'p' })).toBe('p');
		expect(getPepper({})).toBe('');
	});

	it('establishSession regenerates the id then stores the user id', async () => {
		const calls: string[] = [];
		const session = {
			regenerate: vi.fn(async () => {
				calls.push('regenerate');
			}),
			set: vi.fn((key: string, value: number) => {
				calls.push(`set:${key}=${value}`);
			}),
		};
		await establishSession(session, 99);
		// Order matters: regenerate before set, so the user id lands in the new id.
		expect(calls).toEqual(['regenerate', 'set:userId=99']);
		expect(session.set).toHaveBeenCalledWith(SESSION_USER_KEY, 99);
	});

	it('establishSession is a no-op when sessions are unavailable', async () => {
		await expect(establishSession(undefined, 1)).resolves.toBeUndefined();
	});
});
