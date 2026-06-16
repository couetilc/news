import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { insertItems, listItems } from '../src/ingest/db';
import { POST } from '../src/pages/api/read';

const db = env.NEWS_DB;

// Drive the endpoint the way the form does: a urlencoded POST, with a stub
// `redirect` standing in for the one Astro injects at runtime.
const submit = async (fields: Record<string, string>) => {
	const body = new URLSearchParams(fields);
	const request = new Request('http://news.test/api/read', { method: 'POST', body });
	const redirect = (path: string, status: number) =>
		new Response(null, { status, headers: { Location: path } });
	return POST({ request, redirect } as never);
};

beforeEach(async () => {
	await db.prepare('DELETE FROM items').run();
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

describe('POST /api/read', () => {
	it('marks an item read, then back to unread, redirecting each time', async () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		const id = await seedItem();

		const read = await submit({ id: String(id), read: '1' });
		expect(read.status).toBe(303);
		expect(read.headers.get('Location')).toBe('/');
		expect((await listItems(db, 1))[0].read_at).toEqual(expect.any(Number));
		// Mark-read logs the mutation with read:true.
		expect(logSpy).toHaveBeenCalledWith({ level: 'info', event: 'read.toggle', id, read: true });

		const unread = await submit({ id: String(id), read: '0' });
		expect(unread.status).toBe(303);
		expect((await listItems(db, 1))[0].read_at).toBeNull();
		// Mark-unread logs the other branch with read:false.
		expect(logSpy).toHaveBeenCalledWith({ level: 'info', event: 'read.toggle', id, read: false });
	});

	it('redirects back to the filtered + paginated view it was fired from (#80)', async () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		const id = await seedItem();
		// The row on a filtered/paginated page carries that view as `return`; the
		// toggle must land the reader back there, not on the unfiltered home.
		const res = await submit({
			id: String(id),
			read: '1',
			return: '/?source=ieee-spectrum&unread=2&read=3',
		});
		expect(res.status).toBe(303);
		expect(res.headers.get('Location')).toBe('/?source=ieee-spectrum&unread=2&read=3');
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
});
