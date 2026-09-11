import { describe, expect, it, vi } from 'vitest';
import { POST } from '../src/pages/logout';
import {
	establishSession,
	getAllowedEmails,
	getPepper,
	refreshSession,
	SESSION_USER_KEY,
} from '../src/lib/session';

// Drive /logout the way the homepage form does: a POST with a stub `session` and
// `redirect`. No D1 or crypto, but it lives in the workers project alongside the
// other endpoint tests.
describe('POST /logout', () => {
	it('destroys the session and 303-redirects to /login', async () => {
		const destroy = vi.fn();
		const redirect = vi.fn(
			(path: string, status: number) =>
				new Response(null, { status, headers: { Location: path } }),
		);
		const res = await POST({ session: { destroy }, redirect } as never);
		expect(destroy).toHaveBeenCalledOnce();
		expect(res.status).toBe(303);
		expect(res.headers.get('Location')).toBe('/login');
	});

	it('still redirects when there is no session to destroy', async () => {
		const redirect = vi.fn(
			(path: string, status: number) =>
				new Response(null, { status, headers: { Location: path } }),
		);
		const res = await POST({ session: undefined, redirect } as never);
		expect(res.headers.get('Location')).toBe('/login');
	});
});

describe('session helpers', () => {
	it('exposes a stable session key', () => {
		expect(SESSION_USER_KEY).toBe('userId');
	});

	it('reads AUTH_PEPPER from env; allows an empty pepper only outside production', () => {
		// Default isProduction = import.meta.env.PROD, false under the test runner,
		// so the no-arg calls exercise the dev/test path where an empty pepper is OK.
		expect(getPepper({ AUTH_PEPPER: 'p' })).toBe('p');
		expect(getPepper({})).toBe('');
		// Explicit non-prod: an absent pepper is still fine.
		expect(getPepper({}, false)).toBe('');
	});

	it('fails closed in production when AUTH_PEPPER is missing or empty (#189)', () => {
		// In production the pepper is the compensating control for PBKDF2-100k, so a
		// deploy without it must refuse rather than store/accept unpeppered hashes.
		expect(() => getPepper({}, true)).toThrow(/AUTH_PEPPER is required in production/);
		expect(() => getPepper({ AUTH_PEPPER: '' }, true)).toThrow(/AUTH_PEPPER is required/);
		// A configured pepper is returned in production as normal.
		expect(getPepper({ AUTH_PEPPER: 'p' }, true)).toBe('p');
	});

	it('resolves the signup allowlist from AUTH_ALLOWED_EMAILS (issue #76)', () => {
		// Unset → the single-user default.
		expect(getAllowedEmails({})).toEqual(['connor@couetil.com']);
		// Comma-separated, normalized (trim + lowercase), empties dropped.
		expect(
			getAllowedEmails({ AUTH_ALLOWED_EMAILS: ' One@Example.com ,, two@example.COM ,' }),
		).toEqual(['one@example.com', 'two@example.com']);
		// Whitespace/empty-only var falls back to the default rather than locking
		// everyone out.
		expect(getAllowedEmails({ AUTH_ALLOWED_EMAILS: '  ,  ' })).toEqual(['connor@couetil.com']);
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
		await establishSession(session, 99, 1234);
		// Order matters: regenerate before set, so the user id lands in the new id.
		expect(calls).toEqual(['regenerate', 'set:userId=99', 'set:refreshedAt=1234']);
		expect(session.set).toHaveBeenCalledWith(SESSION_USER_KEY, 99);
	});

	it('establishSession is a no-op when sessions are unavailable', async () => {
		await expect(establishSession(undefined, 1)).resolves.toBeUndefined();
	});

	it('refreshes due and legacy sessions only after obtaining a shared claim', async () => {
		const set = vi.fn();
		const claim = vi.fn(async () => true);
		for (const refreshedAt of [undefined, 6400]) {
			const session = { get: async () => refreshedAt, sessionID: 'session', set };
			await refreshSession(session, 99, claim, 10000);
		}
		expect(claim).toHaveBeenCalledTimes(2);
		expect(claim).toHaveBeenCalledWith('session', 10000);
		expect(set.mock.calls).toEqual([['userId', 99], ['refreshedAt', 10000], ['userId', 99], ['refreshedAt', 10000]]);
	});

	it('skips fresh sessions, absent IDs, and requests losing the shared claim', async () => {
		const set = vi.fn();
		const claim = vi.fn(async () => false);
		await refreshSession({ get: async () => 6401, sessionID: 'session', set }, 99, claim, 10000);
		expect(claim).not.toHaveBeenCalled();
		await refreshSession({ get: async () => undefined, sessionID: undefined, set }, 99, claim, 10000);
		expect(claim).not.toHaveBeenCalled();
		await refreshSession({ get: async () => undefined, sessionID: 'session', set }, 99, claim, 10000);
		expect(claim).toHaveBeenCalledOnce();
		expect(set).not.toHaveBeenCalled();
	});

	it('does not mutate the session if the refresh claim fails', async () => {
		const set = vi.fn();
		const claim = async () => { throw new Error('D1 unavailable'); };
		await expect(refreshSession({ get: async () => undefined, sessionID: 'session', set }, 99, claim, 10000)).rejects.toThrow('D1 unavailable');
		expect(set).not.toHaveBeenCalled();
	});

	it('refreshSession is a no-op when sessions are unavailable', async () => {
		await expect(refreshSession(undefined, 1, async () => true)).resolves.toBeUndefined();
	});
});
