import { env } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claimSessionRefresh } from '../src/lib/session-refresh-db';

afterEach(() => vi.restoreAllMocks());

beforeEach(async () => {
	await env.NEWS_DB.prepare('DELETE FROM session_refresh_claims').run();
});

it('grants only one concurrent refresh, separates sessions, and permits a later retry', async () => {
	const claims = await Promise.all(Array.from({ length: 8 }, () => claimSessionRefresh(env.NEWS_DB, 'session-a', 1000)));
	expect(claims.filter(Boolean)).toHaveLength(1);
	expect(await claimSessionRefresh(env.NEWS_DB, 'session-a', 1059)).toBe(false);
	expect(await claimSessionRefresh(env.NEWS_DB, 'session-b', 1000)).toBe(true);
	expect(await claimSessionRefresh(env.NEWS_DB, 'session-a', 1060)).toBe(true);
	const rows = await env.NEWS_DB.prepare('SELECT session_hash,claimed_at FROM session_refresh_claims ORDER BY claimed_at').all<{ session_hash: string; claimed_at: number }>();
	expect(rows.results.map(r => r.claimed_at)).toEqual([1000, 1060]);
	for (const row of rows.results) expect(row.session_hash).toMatch(/^[a-f0-9]{64}$/);
	expect(JSON.stringify(rows.results)).not.toContain('session-a');
});

it('bounds retained claims and propagates database failures', async () => {
	await claimSessionRefresh(env.NEWS_DB, 'old', 1);
	await claimSessionRefresh(env.NEWS_DB, 'recent', 10000);
	await claimSessionRefresh(env.NEWS_DB, 'active', 86402);
	expect((await env.NEWS_DB.prepare('SELECT claimed_at FROM session_refresh_claims ORDER BY claimed_at').all()).results).toEqual([{ claimed_at: 10000 }, { claimed_at: 86402 }]);
	vi.spyOn(env.NEWS_DB, 'batch').mockRejectedValueOnce(new Error('D1 unavailable'));
	await expect(claimSessionRefresh(env.NEWS_DB, 'active', 86500)).rejects.toThrow('D1 unavailable');
});
