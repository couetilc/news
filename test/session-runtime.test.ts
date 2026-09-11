import { afterEach, expect, it, vi } from 'vitest';
import { establishSession, refreshSession } from '../src/lib/session';
import { PERSIST_SYMBOL, testSession } from './helpers/astro-session';
afterEach(() => vi.useRealTimers());

it('keeps ordinary requests read-only, refreshes near expiry, and retains the old session on write failure', async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(10000 * 1000);
	const stored = new Map<string, string>();
	let failWrite = false;
	const setItem = vi.fn(async (key: string, value: string) => {
		if (failWrite) throw new Error('KV unavailable');
		stored.set(key, value);
	});
	const driver = () => ({ getItem: async (key: string) => stored.get(key), setItem, removeItem: async (key: string) => { stored.delete(key); } });
	const driverId = crypto.randomUUID();
	const login = testSession(driver, driverId);
	await establishSession(login.session, 7, 10000);
	await login.session[PERSIST_SYMBOL]();
	const id = login.session.sessionID!;
	expect([...login.cookies.headers()][0]).toContain('Max-Age=1209600');
	setItem.mockClear();
	const claim = vi.fn(async () => true);
	for (let i = 0; i < 3; i++) {
		const request = testSession(driver, driverId, id);
		expect(await request.session.get('userId')).toBe(7);
		await refreshSession(request.session, 7, claim, 10001);
		await request.session[PERSIST_SYMBOL]();
		expect([...request.cookies.headers()]).toEqual([]);
	}
	expect(setItem).not.toHaveBeenCalled();
	expect(claim).not.toHaveBeenCalled();
	const oldRecord = stored.get(id);
	vi.setSystemTime((10000 + 13 * 86400) * 1000);
	const failing = testSession(driver, driverId, id);
	await failing.session.get('userId');
	await refreshSession(failing.session, 7, claim, 10000 + 13 * 86400);
	failWrite = true;
	await expect(failing.session[PERSIST_SYMBOL]()).rejects.toThrow('KV unavailable');
	expect(stored.get(id)).toBe(oldRecord);
	failWrite = false;
	vi.setSystemTime((10000 + 13 * 86400 + 60) * 1000);
	const retry = testSession(driver, driverId, id);
	expect(await retry.session.get('userId')).toBe(7);
	await refreshSession(retry.session, 7, claim, 10000 + 13 * 86400 + 60);
	await retry.session[PERSIST_SYMBOL]();
	expect(retry.session.sessionID).toBe(id);
	expect([...retry.cookies.headers()][0]).toContain('Max-Age=1209600');
	const refreshed = testSession(driver, driverId, id);
	expect(await refreshed.session.get('refreshedAt')).toBe(10000 + 13 * 86400 + 60);
	refreshed.session.destroy();
	await refreshed.session[PERSIST_SYMBOL]();
	expect(stored.has(id)).toBe(false);
});

it('only the winning concurrent request dirties the real Astro session', async () => {
	const stored = new Map<string, string>();
	const setItem = vi.fn(async (key: string, value: string) => { stored.set(key, value); });
	const driver = () => ({ getItem: async (key: string) => stored.get(key), setItem, removeItem: async (key: string) => { stored.delete(key); } });
	const driverId = crypto.randomUUID();
	const login = testSession(driver, driverId);
	await establishSession(login.session, 7, 10000);
	await login.session[PERSIST_SYMBOL]();
	setItem.mockClear();
	const requests = Array.from({ length: 8 }, () => testSession(driver, driverId, login.session.sessionID));
	// D1's atomic winner guarantee is separately tested against real workerd/D1.
	let claimed = false;
	const claim = async () => { if (claimed) return false; claimed = true; return true; };
	await Promise.all(requests.map(async ({ session }) => {
		await session.get('userId');
		await refreshSession(session, 7, claim, 13600);
		await session[PERSIST_SYMBOL]();
	}));
	expect(setItem).toHaveBeenCalledOnce();
	expect(requests.filter(({ cookies }) => [...cookies.headers()].length > 0)).toHaveLength(1);
});
