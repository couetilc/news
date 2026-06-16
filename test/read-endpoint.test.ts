import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { countItemsByRead, insertItems, listItems, listItemsByRead } from '../src/ingest/db';
import { POST } from '../src/pages/api/read';

const db = env.NEWS_DB;

// Drive the endpoint the way the form does: a urlencoded POST, with a stub
// `redirect` standing in for the one Astro injects at runtime. `locals.userId`
// is what the auth middleware sets on every authenticated request (#70); default
// it to USER but let a test override to prove writes are scoped to that user.
const USER = 1;
const submit = async (fields: Record<string, string>, userId: number = USER) => {
	const body = new URLSearchParams(fields);
	const request = new Request('http://news.test/api/read', { method: 'POST', body });
	const redirect = (path: string, status: number) =>
		new Response(null, { status, headers: { Location: path } });
	return POST({ request, redirect, locals: { userId } } as never);
};

beforeEach(async () => {
	await db.batch([db.prepare('DELETE FROM items'), db.prepare('DELETE FROM item_reads')]);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// Seed one item and return its id, so each test can flip a real row.
const seedItem = async () => {
	await insertItems(db, 's', [
		{ guid: 'g1', url: 'https://e.com/a', title: 'T', summary: null, contentHtml: null, publishedAt: 1000 },
	], 100);
	const [{ id }] = await listItems(db, 1);
	return id;
};

// Per-user read state now lives in item_reads, so read it back through the
// per-user section query rather than the global items column.
const isReadFor = async (userId: number, id: number): Promise<boolean> => {
	const read = await listItemsByRead(db, { userId, read: true, limit: 10, offset: 0 });
	return read.some((r) => r.id === id);
};

describe('POST /api/read', () => {
	it('marks an item read, then back to unread, redirecting each time', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const id = await seedItem();

		const read = await submit({ id: String(id), read: '1' });
		expect(read.status).toBe(303);
		expect(read.headers.get('Location')).toBe('/');
		expect(await isReadFor(USER, id)).toBe(true);
		// Mark-read logs the mutation with the user and read:true.
		expect(logSpy).toHaveBeenCalledWith({
			level: 'info',
			event: 'read.toggle',
			userId: USER,
			id,
			read: true,
		});

		const unread = await submit({ id: String(id), read: '0' });
		expect(unread.status).toBe(303);
		expect(await isReadFor(USER, id)).toBe(false);
		// Mark-unread logs the other branch with read:false.
		expect(logSpy).toHaveBeenCalledWith({
			level: 'info',
			event: 'read.toggle',
			userId: USER,
			id,
			read: false,
		});
	});

	it('scopes the write to the session user, leaving other users unaffected (#70)', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const id = await seedItem();
		const USER_A = 1;
		const USER_B = 2;

		// User A marks the item read; only A's state changes.
		await submit({ id: String(id), read: '1' }, USER_A);
		expect(await isReadFor(USER_A, id)).toBe(true);
		expect(await isReadFor(USER_B, id)).toBe(false);
		expect(await countItemsByRead(db, { userId: USER_B, read: true })).toBe(0);

		// User B un-reading their (already-unread) copy does not disturb A's read.
		await submit({ id: String(id), read: '0' }, USER_B);
		expect(await isReadFor(USER_A, id)).toBe(true);
		expect(await isReadFor(USER_B, id)).toBe(false);
	});

	it('degrades to user 0 if the guard ever leaves locals.userId unset', async () => {
		// The auth middleware always sets locals.userId before this gated route, so
		// this is belt-and-suspenders: with no user id the write goes to the
		// no-such-user id 0 (never a real account) rather than crashing or touching
		// a real user's state. Drive that branch with empty locals.
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const id = await seedItem();
		const request = new Request('http://news.test/api/read', {
			method: 'POST',
			body: new URLSearchParams({ id: String(id), read: '1' }),
		});
		const redirect = (path: string, status: number) =>
			new Response(null, { status, headers: { Location: path } });
		const res = await POST({ request, redirect, locals: {} } as never);
		expect(res.status).toBe(303);
		// The write landed under user 0, not any real user.
		expect(await isReadFor(0, id)).toBe(true);
		expect(await isReadFor(USER, id)).toBe(false);
		expect(logSpy).toHaveBeenCalledWith({
			level: 'info',
			event: 'read.toggle',
			userId: 0,
			id,
			read: true,
		});
	});

	it('redirects back to the active tab + filtered view it was fired from (#80, #151)', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const id = await seedItem();
		// The row on a filtered tab carries that view as `return` (active ?tab +
		// ?source filter, #151); the toggle must land the reader back there, not on
		// the unfiltered home.
		const res = await submit({
			id: String(id),
			read: '1',
			return: '/?tab=read&source=ieee-spectrum',
		});
		expect(res.status).toBe(303);
		expect(res.headers.get('Location')).toBe('/?tab=read&source=ieee-spectrum');
	});

	it('rejects a malicious return target, falling back to / (no open redirect)', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const id = await seedItem();
		// Each of these would escape the origin if trusted; the Location must be /.
		for (const evil of ['//evil.com', 'https://evil.com', '/\\evil.com']) {
			const res = await submit({ id: String(id), read: '0', return: evil });
			expect(res.status).toBe(303);
			expect(res.headers.get('Location')).toBe('/');
		}
	});

	it('falls back to / when no return field is present', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const id = await seedItem();
		const res = await submit({ id: String(id), read: '1' });
		expect(res.headers.get('Location')).toBe('/');
	});

	// #140: a missing/non-integer/non-positive id is rejected before any DB write —
	// it redirects back (honoring `return`) as a no-op and logs read.reject, never
	// touching item_reads. Real item ids are positive INTEGER PRIMARY KEYs.
	it('rejects a missing or malformed id as a no-op, writing nothing', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const id = await seedItem();
		// A valid row exists; a bogus toggle must not flip it or create any row.
		for (const bad of ['', 'abc', '1.5', '0', '-3', String(NaN)]) {
			const res = await submit({ id: bad, read: '1', return: '/?source=apple' });
			expect(res.status).toBe(303);
			expect(res.headers.get('Location')).toBe('/?source=apple'); // still redirects back
			expect(await isReadFor(USER, id)).toBe(false);
		}
		const total = await env.NEWS_DB.prepare('SELECT COUNT(*) AS n FROM item_reads').first<number>('n');
		expect(total).toBe(0);
		expect(logSpy).toHaveBeenCalledWith({
			level: 'info',
			event: 'read.reject',
			userId: USER,
			read: true,
		});
	});
});
