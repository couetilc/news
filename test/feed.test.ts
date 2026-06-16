import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countItemsByRead, distinctSources, listItemsByRead } from '../src/ingest/db';
import type { ItemRow } from '../src/ingest/db';

vi.mock('../src/ingest/db', () => ({
	listItemsByRead: vi.fn(),
	countItemsByRead: vi.fn(),
	distinctSources: vi.fn(),
}));

import Feed from '../src/pages/feed.astro';

const row = (over: Partial<ItemRow>): ItemRow => ({
	id: 1,
	source: 'cloudflare-blog',
	guid: 'g',
	url: 'https://example.com/a',
	title: 'A title',
	summary: null,
	content_html: null,
	published_at: 1000,
	fetched_at: 2000,
	read_at: null,
	...over,
});

const many = (n: number, read: boolean, startId = 1): ItemRow[] =>
	Array.from({ length: n }, (_, i) =>
		row({ id: startId + i, title: `Item ${startId + i}`, read_at: read ? 4000 : null }),
	);

// /feed is the infinite-scroll partial (#151): it renders a FRAGMENT — the
// Article <li> rows for one window plus an optional trailing sentinel <li> — that
// the client appends into the homepage <ol>. It's an authed route (the middleware
// sets locals.userId before it runs), so render with a userId.
const USER = 7;
const render = async (url: string, userId: number = USER) => {
	const container = await AstroContainer.create();
	return container.renderToString(Feed, {
		request: new Request(url),
		locals: { userId },
	});
};

describe('feed partial endpoint (#151)', () => {
	afterEach(() => {
		vi.mocked(listItemsByRead).mockReset();
		vi.mocked(countItemsByRead).mockReset();
		vi.mocked(distinctSources).mockReset();
	});

	it('renders one window of unread rows as a fragment (no <html>, no tabs, no list wrapper)', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		vi.mocked(countItemsByRead).mockResolvedValue(120);
		vi.mocked(listItemsByRead).mockResolvedValue(many(50, false, 51));

		const html = await render('https://news.test/feed?tab=unread&offset=50');
		// It's a fragment: the row markup, but not the page chrome / list container.
		expect(html).toContain('Item 51');
		expect(html).not.toContain('<html');
		expect(html).not.toContain('Feed tabs');
		expect(html).not.toContain('data-feed-list');
		// Unread rows carry the mark-read control.
		expect(html).toContain('aria-label="Mark as read"');
	});

	it('queries the requested section + offset + source filter', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
		vi.mocked(countItemsByRead).mockResolvedValue(120);
		vi.mocked(listItemsByRead).mockResolvedValue(many(50, true, 51));

		await render('https://news.test/feed?tab=read&offset=100&source=ieee-spectrum');
		const listCall = vi.mocked(listItemsByRead).mock.calls.at(-1);
		expect(listCall?.[1].read).toBe(true); // read tab
		expect(listCall?.[1].offset).toBe(100); // requested offset, passed through
		expect(listCall?.[1].limit).toBe(50);
		expect(listCall?.[1].sources).toEqual(['ieee-spectrum']);
		expect(listCall?.[1].userId).toBe(USER); // scoped to the session user (#70)
		// The count is narrowed to the same section + source so the sentinel math
		// bounds the right total.
		const countCall = vi.mocked(countItemsByRead).mock.calls.at(-1);
		expect(countCall?.[1].read).toBe(true);
		expect(countCall?.[1].sources).toEqual(['ieee-spectrum']);
	});

	it('emits a next-page sentinel pointing at the following offset while more remain', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		vi.mocked(countItemsByRead).mockResolvedValue(200);
		vi.mocked(listItemsByRead).mockResolvedValue(many(50, false, 51));

		const html = await render('https://news.test/feed?tab=unread&offset=50');
		expect(html).toContain('data-feed-sentinel');
		// offset 50 + 50 returned -> next window starts at 100.
		expect(html).toContain('data-next-url="/feed?tab=unread&amp;offset=100"');
	});

	it('omits the sentinel on the last page — no phantom empty fetch', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		// 120 total; this window is offset 100 returning the final 20 rows.
		vi.mocked(countItemsByRead).mockResolvedValue(120);
		vi.mocked(listItemsByRead).mockResolvedValue(many(20, false, 101));

		const html = await render('https://news.test/feed?tab=unread&offset=100');
		expect(html).toContain('Item 101');
		// 100 + 20 == 120: the list is exhausted, so no sentinel.
		expect(html).not.toContain('data-feed-sentinel');
	});

	it('appended rows return to the active tab + filter (offset dropped) (#80)', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
		vi.mocked(countItemsByRead).mockResolvedValue(120);
		vi.mocked(listItemsByRead).mockResolvedValue(many(50, true, 51));

		const html = await render('https://news.test/feed?tab=read&offset=50&source=ieee-spectrum');
		// Each row's toggle returns to the read tab + source — not the deep offset.
		expect(html).toContain('name="return" value="/?tab=read&amp;source=ieee-spectrum"');
	});

	it('degrades to user 0 if the guard ever leaves locals.userId unset', async () => {
		// The middleware always sets locals.userId before this gated route, so this
		// is the defensive `?? 0` fallback (mirroring /api/read): an empty locals
		// scopes the query to user 0 — a non-existent user, never a real read state —
		// rather than throwing. The Container API has no middleware, so it's the only
		// way to reach this branch.
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		vi.mocked(countItemsByRead).mockResolvedValue(0);
		vi.mocked(listItemsByRead).mockResolvedValue([]);

		const container = await AstroContainer.create();
		await container.renderToString(Feed, {
			request: new Request('https://news.test/feed?tab=unread'),
			locals: {},
		});
		const listCall = vi.mocked(listItemsByRead).mock.calls.at(-1);
		expect(listCall?.[1].userId).toBe(0);
	});

	it('falls back defensively: unknown tab -> unread, junk offset -> 0, unknown source dropped', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		vi.mocked(countItemsByRead).mockResolvedValue(10);
		vi.mocked(listItemsByRead).mockResolvedValue(many(10, false));

		await render('https://news.test/feed?tab=bogus&offset=junk&source=does-not-exist');
		const listCall = vi.mocked(listItemsByRead).mock.calls.at(-1);
		expect(listCall?.[1].read).toBe(false); // unknown tab -> unread section
		expect(listCall?.[1].offset).toBe(0); // junk offset -> 0
		expect(listCall?.[1].sources).toEqual([]); // unknown source dropped -> All
	});
});
