import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countItemsByRead, distinctSources, listItemsByRead } from '../src/ingest/db';
import type { ItemRow } from '../src/ingest/db';

vi.mock('../src/ingest/db', () => ({
	listItemsByRead: vi.fn(),
	countItemsByRead: vi.fn(),
	distinctSources: vi.fn(),
}));

import Index from '../src/pages/index.astro';

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

// The page asks the DB per section (read=false unread, read=true read) for both
// a row window and a count. `feed` wires the section-dispatched mock so a test
// can set each section's rows and total independently — mirroring the two
// independent cursors. Counts default to the rows' length so single-page
// sections "just work" without spelling out a total.
function feed(opts: {
	unread?: ItemRow[];
	read?: ItemRow[];
	unreadTotal?: number;
	readTotal?: number;
}) {
	const unread = opts.unread ?? [];
	const read = opts.read ?? [];
	vi.mocked(listItemsByRead).mockImplementation(async (_db, { read: isRead }) =>
		isRead ? read : unread,
	);
	vi.mocked(countItemsByRead).mockImplementation(async (_db, { read: isRead }) =>
		isRead ? (opts.readTotal ?? read.length) : (opts.unreadTotal ?? unread.length),
	);
}

// `url` drives Astro.url.searchParams (?source, ?unread, ?read); the container
// reads it off the Request it's handed. `userId` is what the auth middleware
// puts on Astro.locals (#70) — the page scopes every read-state query to it; the
// Container API injects it via `locals` (it has no middleware/session of its own).
const USER = 7;
const render = async (url = 'https://news.test/', userId: number = USER) => {
	const container = await AstroContainer.create();
	return container.renderToString(Index, {
		request: new Request(url),
		locals: { userId },
	});
};

describe('index page', () => {
	afterEach(() => {
		vi.mocked(listItemsByRead).mockReset();
		vi.mocked(countItemsByRead).mockReset();
		vi.mocked(distinctSources).mockReset();
	});

	it('shows an empty state when nothing has been aggregated', async () => {
		vi.mocked(distinctSources).mockResolvedValue([]);
		feed({});
		const html = await render();
		expect(html).toContain('Nothing aggregated yet');
		// With no sources present there is no filter bar to draw.
		expect(html).not.toContain('Filter by source');
	});

	it('lists each item with a link, source, and timestamp', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
		feed({
			unread: [
				row({ id: 2, title: 'Newest', url: 'https://example.com/new', source: 'ieee-spectrum', published_at: 5000 }),
				row({ id: 1, title: 'No date', url: 'https://example.com/old', published_at: null, fetched_at: 3000 }),
			],
		});

		const html = await render();
		expect(html).not.toContain('Nothing aggregated yet');
		expect(html).toContain('href="https://example.com/new"');
		expect(html).toContain('Newest');
		// A registered source shows its display name and its color-flag class,
		// not the raw slug.
		expect(html).toContain('IEEE Spectrum');
		expect(html).toContain('bg-source-ieee');
		expect(html).toContain('Cloudflare Blog');
		expect(html).toContain('bg-source-cloudflare');
		// published_at is used when present...
		expect(html).toContain(`datetime="${new Date(5000 * 1000).toISOString()}"`);
		// ...and fetched_at is the fallback when it is null.
		expect(html).toContain(`datetime="${new Date(3000 * 1000).toISOString()}"`);
		// All unread: every item offers a "mark read" control and there is no
		// Read section header.
		expect(html).toContain('aria-label="Mark as read"');
		expect(html).not.toContain('aria-label="Mark as unread"');
		expect(html).not.toMatch(/>\s*Read\s*</);
		// One page each side: no pager renders.
		expect(html).not.toContain('Page 1 of');
	});

	it('degrades to user 0 (everything unread) if the guard ever leaves locals.userId unset', async () => {
		// The auth middleware always sets locals.userId before this gated page runs,
		// so this is belt-and-suspenders: with no user id the page must not crash —
		// it queries the no-such-user id 0, which owns no reads, so the feed renders
		// as fully unread. Render with no locals at all to drive that branch.
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		feed({ unread: [row({ id: 1, title: 'Still unread', read_at: null })] });

		const container = await AstroContainer.create();
		const html = await container.renderToString(Index, {
			request: new Request('https://news.test/'),
		});
		expect(html).toContain('Still unread');
		// The fallback id flowed into the query.
		expect(vi.mocked(listItemsByRead).mock.calls[0][1].userId).toBe(0);
	});

	it('falls back to the raw slug and the neutral flag for an unregistered source', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['mystery-wire']);
		feed({ unread: [row({ source: 'mystery-wire', title: 'Unknown source' })] });

		const html = await render();
		expect(html).toContain('mystery-wire');
		expect(html).toContain('bg-muted');
	});

	it('drops read items into a Read section with an un-read control', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		feed({
			unread: [row({ id: 2, title: 'Still unread', read_at: null })],
			read: [row({ id: 1, title: 'Already read', read_at: 4000 })],
		});

		const html = await render();
		// The section header appears once both states are present.
		expect(html).toMatch(/>\s*Read\s*</);
		// The read row carries the timestamp and the inverse (un-read) control;
		// the unread row carries the mark-read control.
		expect(html).toContain('Already read');
		expect(html).toContain('aria-label="Mark as unread"');
		expect(html).toContain('aria-label="Mark as read"');
		// Each control posts the item id to the toggle endpoint.
		expect(html).toContain('action="/api/read"');
		expect(html).toContain('name="id"');
	});

	it('scopes the read/unread split to the logged-in user (#70)', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		// Two different users would see different splits; the page must query for
		// the one on locals and render exactly that user's sections.
		vi.mocked(listItemsByRead).mockImplementation(async (_db, { read: isRead }) =>
			isRead
				? [row({ id: 1, title: 'User 7 read item', read_at: 4000 })]
				: [row({ id: 2, title: 'User 7 unread item', read_at: null })],
		);
		vi.mocked(countItemsByRead).mockResolvedValue(1);

		const html = await render('https://news.test/', 7);
		// The page rendered this user's split: their unread item in the feed, their
		// read item under the Read header.
		expect(html).toContain('User 7 unread item');
		expect(html).toContain('User 7 read item');
		expect(html).toMatch(/>\s*Read\s*</);
		// Every read-state query carried this user's id (the per-user scoping #70
		// hinges on), for both the row windows and the counts.
		for (const call of vi.mocked(listItemsByRead).mock.calls) {
			expect(call[1].userId).toBe(7);
		}
		for (const call of vi.mocked(countItemsByRead).mock.calls) {
			expect(call[1].userId).toBe(7);
		}
	});

	it('wires up the read/unread move animation: client router + per-item morph targets', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		feed({
			unread: [row({ id: 2, title: 'Still unread', read_at: null })],
			read: [row({ id: 1, title: 'Already read', read_at: 4000 })],
		});

		const html = await render();
		// The client router upgrades the form POST → 303 reload into a
		// view-transition navigation (with JS off the form still posts normally).
		expect(html).toContain('astro-view-transitions-enabled');
		// Each Article row carries its own transition scope, so the browser tracks
		// it as a distinct element and morphs the toggled item from its old slot to
		// its new one across the swap. The view-transition-name keyed to the item id
		// (transition:name={`item-${id}`}) is emitted in a scoped <style> pushed to
		// extraHead, which the Container API doesn't inline — so we assert on the
		// per-row scope attribute it does render: two rows, two distinct scopes.
		const scopes = [...html.matchAll(/data-astro-transition-scope="([^"]+)"/g)].map((m) => m[1]);
		expect(new Set(scopes).size).toBe(2);
	});

	it('renders only the Read section when every item has been read', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		feed({ read: [row({ id: 1, title: 'Read one', read_at: 4000 })] });

		const html = await render();
		expect(html).toMatch(/>\s*Read\s*</);
		expect(html).toContain('aria-label="Mark as unread"');
		expect(html).not.toContain('aria-label="Mark as read"');
	});

	describe('source filter bar', () => {
		it('renders a chip per present source with name + swatch, plus an All reset', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			feed({ unread: [row({})] });

			const html = await render();
			expect(html).toContain('Filter by source');
			// One chip per present source, each with its display name and swatch.
			expect(html).toContain('Cloudflare Blog');
			expect(html).toContain('bg-source-cloudflare');
			expect(html).toContain('IEEE Spectrum');
			expect(html).toContain('bg-source-ieee');
			// The All reset links to the bare path (clears the filter).
			expect(html).toMatch(/href="\/"[^>]*>All</);
			// With no ?source, nothing is marked active and every source is queried.
			expect(vi.mocked(listItemsByRead).mock.calls[0][1].sources).toEqual([]);
		});

		it('marks the selected source active and narrows the query to it', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			feed({ unread: [row({ source: 'ieee-spectrum' })] });

			const html = await render('https://news.test/?source=ieee-spectrum');
			// Both the row window and the count are narrowed to the active source.
			expect(vi.mocked(listItemsByRead).mock.calls[0][1].sources).toEqual(['ieee-spectrum']);
			expect(vi.mocked(countItemsByRead).mock.calls[0][1].sources).toEqual(['ieee-spectrum']);
			// Each row's read toggle carries the current filtered view as its return
			// target, so flipping an item keeps the filter rather than dropping to / (#80).
			expect(html).toContain('name="return" value="/?source=ieee-spectrum"');
			// The active chip carries aria-current; the inactive chip's href toggles
			// it on (adds its slug to the selection) for multi-select without JS.
			expect(html).toMatch(/aria-current="true"/);
			expect(html).toContain('source=cloudflare-blog');
			expect(html).toContain('source=ieee-spectrum');
		});

		it('supports multi-select via repeated ?source params', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum', 'apple']);
			feed({ unread: [row({})] });

			await render('https://news.test/?source=cloudflare-blog&source=apple');
			expect(vi.mocked(listItemsByRead).mock.calls[0][1].sources).toEqual(['cloudflare-blog', 'apple']);
		});

		it('treats an unknown ?source as All (filtered out, never a 500)', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: [row({})] });

			const html = await render('https://news.test/?source=does-not-exist');
			// The unknown slug is dropped, so the query runs unfiltered ("All").
			expect(vi.mocked(listItemsByRead).mock.calls[0][1].sources).toEqual([]);
			// The All reset is the active chip.
			expect(html).toMatch(/href="\/"[^>]*aria-current="true"[^>]*>All</);
		});

		it('shows a per-source empty state when the selection has no items', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({});

			const html = await render('https://news.test/?source=cloudflare-blog');
			// Not the global empty state — the filter bar still shows so the reader
			// can clear the selection.
			expect(html).not.toContain('Nothing aggregated yet');
			expect(html).toContain('Nothing here from this source yet');
			expect(html).toContain('Filter by source');
		});
	});

	describe('pagination', () => {
		const many = (n: number, read: boolean): ItemRow[] =>
			Array.from({ length: n }, (_, i) =>
				row({ id: i + 1, title: `Item ${i + 1}`, read_at: read ? 4000 : null }),
			);

		it('renders no pager when each section fits on one page (≤50)', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: many(50, false), unreadTotal: 50 });
			const html = await render();
			expect(html).not.toContain('Page 1 of');
			expect(html).not.toContain('Next →');
		});

		it('shows next (not prev) on page 1 of a multi-page section', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: many(50, false), unreadTotal: 120 });
			const html = await render();
			expect(html).toContain('Page 1 of 3');
			expect(html).toContain('Next →');
			// Prev is rendered as a disabled span on page 1 (no link href to page 0).
			expect(html).not.toContain('rel="prev"');
			expect(html).toContain('rel="next"');
			// Next link advances the unread cursor only.
			expect(html).toContain('href="/?unread=2"');
		});

		it('shows prev (not next) on the last page', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: many(20, false), unreadTotal: 120 });
			const html = await render('https://news.test/?unread=3');
			expect(html).toContain('Page 3 of 3');
			expect(html).toContain('rel="prev"');
			expect(html).not.toContain('rel="next"');
			expect(html).toContain('href="/?unread=2"');
		});

		it('clamps a too-far page onto the last page', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: many(20, false), unreadTotal: 120 });
			// ?unread=99 is past the last page (3); it clamps to page 3.
			const html = await render('https://news.test/?unread=99');
			expect(html).toContain('Page 3 of 3');
			// Offset reflects the clamped page, not the requested one.
			expect(vi.mocked(listItemsByRead).mock.calls.find((c) => !c[0]?.read));
			const unreadCall = vi
				.mocked(listItemsByRead)
				.mock.calls.find((c) => c[1].read === false);
			expect(unreadCall?.[1].offset).toBe(100);
		});

		it('parses a non-numeric / zero / negative page as page 1', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: many(50, false), unreadTotal: 120 });
			const html = await render('https://news.test/?unread=abc');
			expect(html).toContain('Page 1 of 3');
			const html0 = await render('https://news.test/?unread=0');
			expect(html0).toContain('Page 1 of 3');
			const htmlNeg = await render('https://news.test/?unread=-2');
			expect(htmlNeg).toContain('Page 1 of 3');
		});

		it('paginates the two sections on independent cursors', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({
				unread: many(50, false),
				read: many(50, true),
				unreadTotal: 120,
				readTotal: 120,
			});
			const html = await render('https://news.test/?unread=2&read=3');
			// Each section shows its own page number.
			expect(html).toContain('Page 2 of 3');
			expect(html).toContain('Page 3 of 3');
			// Each section requested its own offset.
			const unreadCall = vi.mocked(listItemsByRead).mock.calls.find((c) => c[1].read === false);
			const readCall = vi.mocked(listItemsByRead).mock.calls.find((c) => c[1].read === true);
			expect(unreadCall?.[1].offset).toBe(50);
			expect(readCall?.[1].offset).toBe(100);
		});

		it('page links carry the active ?source and preserve the sibling cursor', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			feed({
				unread: many(50, false),
				read: many(50, true),
				unreadTotal: 120,
				readTotal: 120,
			});
			const html = await render('https://news.test/?source=ieee-spectrum&unread=2&read=2');
			// The unread "next" link keeps the source and the read cursor (=2),
			// advancing only unread to 3.
			expect(html).toContain('href="/?source=ieee-spectrum&amp;read=2&amp;unread=3"');
			// The read "next" link keeps the source and the unread cursor (=2),
			// advancing only read to 3.
			expect(html).toContain('href="/?source=ieee-spectrum&amp;unread=2&amp;read=3"');
		});

		it('omits the sibling cursor from links when the sibling is on page 1', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({
				unread: many(50, false),
				read: many(10, true),
				unreadTotal: 120,
				readTotal: 10,
			});
			const html = await render('https://news.test/?unread=2');
			// Read is single-page (page 1), so the unread links don't carry ?read.
			expect(html).toContain('href="/?unread=3"');
			expect(html).not.toContain('read=1');
		});
	});
});
