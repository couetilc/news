import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { countItemsByRead, distinctSources, listItems, listItemsByRead } from '../src/ingest/db';
import type { ItemRow } from '../src/ingest/db';

vi.mock('../src/ingest/db', () => ({
	listItems: vi.fn(),
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

// The tabbed homepage (#151) renders only the ACTIVE tab's first 50 rows
// (listItemsByRead at offset 0 with read = the active tab's flag) plus BOTH tab
// counts (countItemsByRead for each, for the tally + infinite-scroll bound).
// `feed` wires the section-dispatched mocks so a test sets each tab's rows and
// total independently; the list mock returns the rows for whichever tab the page
// queries, the count mock returns each tab's total. Counts default to the rows'
// length so a single-page tab "just works" without spelling out a total.
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

// `url` drives Astro.url.searchParams (?source, ?tab); the container reads it off
// the Request it's handed. `userId` is what the auth middleware puts on
// Astro.locals (#70) — the page scopes every read-state query to it; the
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
		vi.mocked(listItems).mockReset();
		vi.mocked(listItemsByRead).mockReset();
		vi.mocked(countItemsByRead).mockReset();
		vi.mocked(distinctSources).mockReset();
	});

	it('shows an empty state when nothing has been aggregated', async () => {
		vi.mocked(distinctSources).mockResolvedValue([]);
		feed({});
		const html = await render();
		expect(html).toContain('Nothing aggregated yet');
		// With no sources present there is no filter bar and no tabs to draw.
		expect(html).not.toContain('Filter by source');
		expect(html).not.toContain('Feed tabs');
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
		// A registered source shows its display name and its color-flag class.
		expect(html).toContain('IEEE Spectrum');
		expect(html).toContain('bg-source-ieee');
		expect(html).toContain('Cloudflare Blog');
		expect(html).toContain('bg-source-cloudflare');
		// published_at is used when present...
		expect(html).toContain(`datetime="${new Date(5000 * 1000).toISOString()}"`);
		// ...and fetched_at is the fallback when it is null.
		expect(html).toContain(`datetime="${new Date(3000 * 1000).toISOString()}"`);
		// Unread is the active (default) tab, so every row offers a mark-read control.
		expect(html).toContain('aria-label="Mark as read"');
		expect(html).not.toContain('aria-label="Mark as unread"');
		// One page (≤50): no infinite-scroll sentinel.
		expect(html).not.toContain('data-feed-sentinel');
	});

	describe('tabs (#151)', () => {
		it('defaults to the Unread tab and queries the unread section at offset 0', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({
				unread: [row({ id: 2, title: 'Fresh unread', read_at: null })],
				read: [row({ id: 1, title: 'Old read', read_at: 4000 })],
			});

			const html = await render();
			// Both tab labels render, with their tallies.
			expect(html).toContain('Feed tabs');
			expect(html).toMatch(/>\s*Unread\s*</);
			expect(html).toMatch(/>\s*Read\s*</);
			// Unread is the active tab (aria-current) and its content shows.
			expect(html).toMatch(/aria-current="page"[^>]*>\s*Unread/);
			expect(html).toContain('Fresh unread');
			// The read item is NOT rendered — only the active tab's rows load.
			expect(html).not.toContain('Old read');
			// The active-tab list query asked for the unread section at offset 0.
			const listCall = vi.mocked(listItemsByRead).mock.calls.at(-1);
			expect(listCall?.[1].read).toBe(false);
			expect(listCall?.[1].offset).toBe(0);
		});

		it('shows the Read tab when ?tab=read and queries the read section', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({
				unread: [row({ id: 2, title: 'Fresh unread', read_at: null })],
				read: [row({ id: 1, title: 'Old read', read_at: 4000 })],
			});

			const html = await render('https://news.test/?tab=read');
			// Read is now the active tab; its rows render with the un-read control.
			expect(html).toMatch(/aria-current="page"[^>]*>\s*Read/);
			expect(html).toContain('Old read');
			expect(html).toContain('aria-label="Mark as unread"');
			// The unread item is not rendered on the read tab.
			expect(html).not.toContain('Fresh unread');
			const listCall = vi.mocked(listItemsByRead).mock.calls.at(-1);
			expect(listCall?.[1].read).toBe(true);
		});

		it('falls back to Unread for an unknown ?tab value', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: [row({ title: 'Fresh unread' })] });

			const html = await render('https://news.test/?tab=bogus');
			expect(html).toMatch(/aria-current="page"[^>]*>\s*Unread/);
			expect(html).toContain('Fresh unread');
		});

		it('shows each tab tally from its count, independent of which tab is active', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			// 3 unread, 2 read; only the unread page-1 rows render, but both tallies show.
			feed({
				unread: [row({ id: 3 }), row({ id: 2 }), row({ id: 1 })],
				read: [row({ id: 5, read_at: 4000 }), row({ id: 4, read_at: 4000 })],
				unreadTotal: 3,
				readTotal: 2,
			});

			const html = await render();
			// Both counts queried (one per tab) regardless of active tab.
			const reads = vi.mocked(countItemsByRead).mock.calls.map((c) => c[1].read);
			expect(reads).toContain(true);
			expect(reads).toContain(false);
			// The tallies render beside their labels.
			expect(html).toMatch(/Unread\s*<span[^>]*>3</);
			expect(html).toMatch(/Read\s*<span[^>]*>2</);
			// Each tally carries data-tab-count so the in-place read toggle (#223) can
			// re-count both tabs after moving a row between them.
			expect(html).toContain('data-tab-count="unread"');
			expect(html).toContain('data-tab-count="read"');
		});

		it('the inactive tab is not fetched for rows — only the active one', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({
				unread: [row({ id: 2, title: 'Fresh unread' })],
				read: [row({ id: 1, title: 'Old read', read_at: 4000 })],
			});

			await render(); // unread active
			// Exactly one list (rows) query ran — the active tab's; the read rows were
			// never fetched (its tally comes from the count, not a row window).
			const listReads = vi.mocked(listItemsByRead).mock.calls.map((c) => c[1].read);
			expect(listReads).toEqual([false]);
		});

		it('a tab href carries the active source filter and (for read) ?tab=read', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			feed({ unread: [row({ source: 'ieee-spectrum' })] });

			const html = await render('https://news.test/?source=ieee-spectrum');
			// The Read tab link keeps the source filter and switches to ?tab=read.
			expect(html).toContain('href="/?tab=read&amp;source=ieee-spectrum"');
			// The Unread tab link is the default (no ?tab), keeping the source filter.
			expect(html).toContain('href="/?source=ieee-spectrum"');
		});
	});

	describe('infinite scroll (#151)', () => {
		const many = (n: number, read: boolean): ItemRow[] =>
			Array.from({ length: n }, (_, i) =>
				row({ id: i + 1, title: `Item ${i + 1}`, read_at: read ? 4000 : null }),
			);

		it('renders no sentinel when the active tab fits on one page (≤50)', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: many(50, false), unreadTotal: 50 });
			const html = await render();
			expect(html).not.toContain('data-feed-sentinel');
		});

		it('renders the sentinel with the next-page /feed URL when more remain', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: many(50, false), unreadTotal: 120 });
			const html = await render();
			// The list is the infinite-scroll hook the client appends into.
			expect(html).toContain('data-feed-list');
			// It also carries the filter/tab-aware caught-up copy as data-empty-message
			// so the in-place read toggle (#223) can render this tab's empty state
			// client-side when its last row is toggled away, without reconstructing it.
			expect(html).toContain('data-empty-message="All caught up — nothing unread."');
			// The sentinel carries the next window's URL: the active tab + offset 50.
			expect(html).toContain('data-feed-sentinel');
			expect(html).toContain('data-next-url="/feed?tab=unread&amp;offset=50"');
		});

		it('the read tab sentinel points at the read tab next page, carrying ?source', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			feed({ read: many(50, true), readTotal: 120 });
			const html = await render('https://news.test/?tab=read&source=ieee-spectrum');
			expect(html).toContain(
				'data-next-url="/feed?tab=read&amp;source=ieee-spectrum&amp;offset=50"',
			);
		});
	});

	describe('anonymous (session-adaptive) view (#87)', () => {
		// With no locals.userId the page is the public read-only feed: the global
		// listItems() column rendered with interactive={false}, plus a Log in link,
		// and never the per-user queries. Unchanged by the tabs work (#151).
		const renderAnon = async (url = 'https://news.test/') => {
			const container = await AstroContainer.create();
			return container.renderToString(Index, { request: new Request(url), locals: {} });
		};

		it('renders the public read-only feed via listItems, with a Log in link and no write form', async () => {
			vi.mocked(listItems).mockResolvedValue([
				row({ id: 2, title: 'Newest', url: 'https://example.com/new', source: 'ieee-spectrum', published_at: 5000 }),
				row({ id: 1, title: 'Read by Connor', read_at: 4000 }),
			]);

			const html = await renderAnon();
			expect(html).toContain('href="https://example.com/new"');
			expect(html).toContain('Newest');
			expect(html).toContain('Read by Connor');
			// interactive={false}: no write form, no toggle, no tabs, no dimming.
			expect(html).not.toContain('action="/api/read"');
			expect(html).not.toContain('<form');
			expect(html).not.toContain('aria-label="Mark as read"');
			expect(html).not.toContain('aria-label="Mark as unread"');
			expect(html).not.toContain('Feed tabs');
			expect(html).not.toContain('data-feed-sentinel');
			expect(html).not.toContain('opacity-55');
			// A Log in link is present, pointing at /login.
			expect(html).toContain('Log in');
			expect(html).toContain('href="/login"');
			// The personal feed's controls (filter, sign out) are absent.
			expect(html).not.toContain('Filter by source');
			expect(html).not.toContain('Sign out');
			// The anonymous branch never runs the per-user read-state queries.
			expect(vi.mocked(listItemsByRead)).not.toHaveBeenCalled();
			expect(vi.mocked(countItemsByRead)).not.toHaveBeenCalled();
			expect(vi.mocked(distinctSources)).not.toHaveBeenCalled();
		});

		it('shows the empty state (and still the Log in link) when nothing is aggregated', async () => {
			vi.mocked(listItems).mockResolvedValue([]);
			const html = await renderAnon();
			expect(html).toContain('Nothing aggregated yet');
			expect(html).toContain('Log in');
		});
	});

	describe('pinned references strip (#316)', () => {
		// The Trump Policy Impact Tracker PDF is pinned above the FilterBar for both
		// auth states. Assert it on the rendered index page (not just the component)
		// so the placement contract — above the source filter, present in either auth
		// state — is pinned where it actually composes.
		const TRACKER_HREF =
			'https://assets.jpmprivatebank.com/content/dam/jpm-pb-aem/global/en/documents/eotm/trump-tracker.pdf';

		it('renders the pinned tracker above the FilterBar for a logged-in visitor', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: [row({})] });

			const html = await render();
			// The pinned PDF link is present, with its external-tab safety attributes.
			expect(html).toContain(`href="${TRACKER_HREF}"`);
			expect(html).toContain('Trump Policy Impact Tracker');
			expect(html).toContain('aria-label="Pinned references"');
			// It sits ABOVE the source FilterBar (the decided Option A placement).
			const pinnedAt = html.indexOf('aria-label="Pinned references"');
			const filterAt = html.indexOf('aria-label="Filter by source"');
			expect(pinnedAt).toBeGreaterThan(-1);
			expect(filterAt).toBeGreaterThan(-1);
			expect(pinnedAt).toBeLessThan(filterAt);
		});

		it('renders the pinned tracker for an anonymous visitor too', async () => {
			vi.mocked(listItems).mockResolvedValue([row({})]);
			const container = await AstroContainer.create();
			const html = await container.renderToString(Index, {
				request: new Request('https://news.test/'),
				locals: {},
			});
			// Visible to anonymous visitors (no FilterBar in this branch, but the strip
			// still shows above the public feed).
			expect(html).toContain(`href="${TRACKER_HREF}"`);
			expect(html).toContain('Trump Policy Impact Tracker');
			expect(html).toContain('aria-label="Pinned references"');
			// The pinned strip precedes the feed list.
			const pinnedAt = html.indexOf('aria-label="Pinned references"');
			const feedAt = html.indexOf('<ol');
			expect(pinnedAt).toBeGreaterThan(-1);
			expect(pinnedAt).toBeLessThan(feedAt);
		});

		it('shows the pinned tracker even when nothing has been aggregated', async () => {
			// The strip is its own lane, independent of feed state — it must survive the
			// empty homepage so the reference is reachable from day one.
			vi.mocked(distinctSources).mockResolvedValue([]);
			feed({});
			const html = await render();
			expect(html).toContain('Nothing aggregated yet');
			expect(html).toContain(`href="${TRACKER_HREF}"`);
		});
	});

	it('falls back to the raw slug and the neutral flag for an unregistered source', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['mystery-wire']);
		feed({ unread: [row({ source: 'mystery-wire', title: 'Unknown source' })] });

		const html = await render();
		expect(html).toContain('mystery-wire');
		expect(html).toContain('bg-muted');
	});

	it('scopes the read/unread tabs to the logged-in user (#70)', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		vi.mocked(listItemsByRead).mockImplementation(async (_db, { read: isRead }) =>
			isRead
				? [row({ id: 1, title: 'User 7 read item', read_at: 4000 })]
				: [row({ id: 2, title: 'User 7 unread item', read_at: null })],
		);
		vi.mocked(countItemsByRead).mockResolvedValue(1);

		const html = await render('https://news.test/', 7);
		// Unread is the active tab, so this user's unread item shows.
		expect(html).toContain('User 7 unread item');
		// Every read-state query carried this user's id (the per-user scoping #70
		// hinges on), for both the row window and the counts.
		for (const call of vi.mocked(listItemsByRead).mock.calls) {
			expect(call[1].userId).toBe(7);
		}
		for (const call of vi.mocked(countItemsByRead).mock.calls) {
			expect(call[1].userId).toBe(7);
		}
	});

	it('wires up the read/unread move animation: client router + per-item morph targets', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		feed({ unread: [row({ id: 2 }), row({ id: 3 })] });

		const html = await render();
		// The client router upgrades the form POST → 303 reload into a
		// view-transition navigation (with JS off the form still posts normally).
		expect(html).toContain('astro-view-transitions-enabled');
		// Each Article row carries its own transition scope, so the browser tracks
		// it distinctly. The per-item view-transition-name is emitted in a scoped
		// <style> the Container API doesn't inline; assert on the per-row scope
		// attribute it does render: two rows, two distinct scopes.
		const scopes = [...html.matchAll(/data-astro-transition-scope="([^"]+)"/g)].map((m) => m[1]);
		expect(new Set(scopes).size).toBe(2);
	});

	describe('empty states per tab', () => {
		it('shows a caught-up message on an empty unread tab (no filter)', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			// Sources present, but the unread tab is empty (everything read).
			feed({ unread: [], read: [row({ read_at: 4000 })], unreadTotal: 0, readTotal: 1 });
			const html = await render();
			expect(html).not.toContain('Nothing aggregated yet');
			expect(html).toContain('All caught up — nothing unread.');
			// The empty <p> carries data-feed-empty — the same marker the in-place read
			// toggle (#223) renders when it empties a tab, so server and client agree.
			expect(html).toContain('data-feed-empty');
			// Tabs still render so the reader can switch to Read.
			expect(html).toContain('Feed tabs');
		});

		it('shows a none-read message on an empty read tab', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: [row({})], read: [], unreadTotal: 1, readTotal: 0 });
			const html = await render('https://news.test/?tab=read');
			expect(html).toContain('Nothing read yet.');
		});

		it('shows a per-source empty message when a filtered unread tab has no matches', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: [], read: [], unreadTotal: 0, readTotal: 0 });
			const html = await render('https://news.test/?source=cloudflare-blog');
			expect(html).not.toContain('Nothing aggregated yet');
			expect(html).toContain('Nothing unread from this source.');
			// Filter bar stays so the reader can clear the selection.
			expect(html).toContain('Filter by source');
		});

		it('shows a per-source empty message on a filtered, empty read tab', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: [], read: [], unreadTotal: 0, readTotal: 0 });
			const html = await render('https://news.test/?tab=read&source=cloudflare-blog');
			expect(html).toContain('Nothing read from this source yet.');
		});
	});

	describe('source filter bar', () => {
		it('renders a chip per present source with name + swatch, plus an All reset', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			feed({ unread: [row({})] });

			const html = await render();
			expect(html).toContain('Filter by source');
			expect(html).toContain('Cloudflare Blog');
			expect(html).toContain('bg-source-cloudflare');
			expect(html).toContain('IEEE Spectrum');
			expect(html).toContain('bg-source-ieee');
			// The All reset links to the bare path (clears the filter).
			expect(html).toMatch(/href="\/"[^>]*>All</);
			// With no ?source, nothing is marked active and every source is queried.
			expect(vi.mocked(listItemsByRead).mock.calls[0][1].sources).toEqual([]);
			expect(html).toMatch(/href="\/"[^>]*class="[^"]*focus-visible:outline-ink/);
		});

		it('marks the selected source active and narrows the active tab query to it', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			feed({ unread: [row({ source: 'ieee-spectrum' })] });

			const html = await render('https://news.test/?source=ieee-spectrum');
			// Both the row window and BOTH tab counts are narrowed to the active source.
			expect(vi.mocked(listItemsByRead).mock.calls[0][1].sources).toEqual(['ieee-spectrum']);
			for (const call of vi.mocked(countItemsByRead).mock.calls) {
				expect(call[1].sources).toEqual(['ieee-spectrum']);
			}
			// Each row's read toggle carries the current filtered view as its return
			// target, so flipping an item keeps the filter (and tab) rather than
			// dropping to / (#80). The default tab adds no ?tab, so it's source-only.
			expect(html).toContain('name="return" value="/?source=ieee-spectrum"');
			expect(html).toMatch(/aria-current="true"/);
			expect(html).toContain('source=cloudflare-blog');
			expect(html).toContain('source=ieee-spectrum');
		});

		it('carries the active tab into the toggle return target on the read tab', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ read: [row({ read_at: 4000 })] });
			const html = await render('https://news.test/?tab=read');
			// Returning from a toggle on the read tab keeps ?tab=read.
			expect(html).toContain('name="return" value="/?tab=read"');
		});

		// Slice out just the source-filter <nav> so an assertion about chip hrefs
		// isn't satisfied (or tripped) by the FeedTabs nav, which always renders a
		// /?tab=read link of its own. The filter bar is the only "Filter by source"
		// landmark, so this isolates the chips under test (#217).
		const filterNav = (html: string): string => {
			const open = html.indexOf('<nav aria-label="Filter by source"');
			return html.slice(open, html.indexOf('</nav>', open));
		};

		it('source chips carry the active ?tab=read so filtering keeps the Read tab (#217)', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			feed({ read: [row({ read_at: 4000 })] });

			const nav = filterNav(await render('https://news.test/?tab=read'));
			// Each off chip turns its source ON while keeping ?tab=read, so a click on
			// the Read tab filters Read history instead of dropping to Unread. ?tab
			// leads the query string (mirroring the tab links), & is HTML-escaped.
			expect(nav).toContain('href="/?tab=read&amp;source=cloudflare-blog"');
			expect(nav).toContain('href="/?tab=read&amp;source=ieee-spectrum"');
			// The All reset stays on the Read tab too (clears source, keeps the tab).
			expect(nav).toMatch(/href="\/\?tab=read"[^>]*>All</);
			// It must NOT emit a tab-less chip href that would reset to Unread.
			expect(nav).not.toContain('href="/?source=cloudflare-blog"');
			expect(nav).not.toMatch(/href="\/"[^>]*>All</);
		});

		it('an active read-tab source chip toggles itself OFF while keeping ?tab=read (#217)', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			feed({ read: [row({ source: 'ieee-spectrum', read_at: 4000 })] });

			const nav = filterNav(await render('https://news.test/?tab=read&source=ieee-spectrum'));
			// The active chip's href drops its own slug but preserves the tab, so
			// turning a filter off on Read stays on Read (not back to Unread).
			expect(nav).toMatch(/href="\/\?tab=read"[^>]*aria-current="true"[^>]*>[\s\S]*?IEEE Spectrum/);
			// The other (off) chip ADDS its slug alongside the active one, still on Read.
			expect(nav).toContain('href="/?tab=read&amp;source=ieee-spectrum&amp;source=cloudflare-blog"');
		});

		it('source chips omit ?tab on the default Unread tab for clean URLs (#217)', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			feed({ unread: [row({})] });

			const nav = filterNav(await render('https://news.test/?tab=unread'));
			// Unread is the default, so chip + All hrefs stay tab-less.
			expect(nav).toContain('href="/?source=cloudflare-blog"');
			expect(nav).toMatch(/href="\/"[^>]*>All</);
			expect(nav).not.toContain('tab=read');
			expect(nav).not.toContain('tab=unread');
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
			expect(vi.mocked(listItemsByRead).mock.calls[0][1].sources).toEqual([]);
			expect(html).toMatch(/href="\/"[^>]*aria-current="true"[^>]*>All</);
		});
	});
});
