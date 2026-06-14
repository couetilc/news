import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
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

describe('POST /api/read', () => {
	it('marks an item read, then back to unread, redirecting each time', async () => {
		await insertItems(db, 's', [
			{ guid: 'g1', url: 'https://e.com/a', title: 'T', summary: null, contentHtml: null, publishedAt: 1000 },
		], 100);
		const [{ id }] = await listItems(db, 1);

		const read = await submit({ id: String(id), read: '1' });
		expect(read.status).toBe(303);
		expect(read.headers.get('Location')).toBe('/');
		expect((await listItems(db, 1))[0].read_at).toEqual(expect.any(Number));

		const unread = await submit({ id: String(id), read: '0' });
		expect(unread.status).toBe(303);
		expect((await listItems(db, 1))[0].read_at).toBeNull();
	});
});
