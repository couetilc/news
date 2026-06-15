import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { distinctSources, listItems } from '../src/ingest/db';
import type { ItemRow } from '../src/ingest/db';

vi.mock('../src/ingest/db', () => ({ listItems: vi.fn(), distinctSources: vi.fn() }));

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

// `url` drives Astro.url.searchParams (the ?source filter); the container reads
// it off the Request it's handed.
const render = async (url = 'https://news.test/') => {
	const container = await AstroContainer.create();
	return container.renderToString(Index, { request: new Request(url) });
};

describe('index page', () => {
	afterEach(() => {
		vi.mocked(listItems).mockReset();
		vi.mocked(distinctSources).mockReset();
	});

	it('shows an empty state when nothing has been aggregated', async () => {
		vi.mocked(distinctSources).mockResolvedValue([]);
		vi.mocked(listItems).mockResolvedValue([]);
		const html = await render();
		expect(html).toContain('Nothing aggregated yet');
		// With no sources present there is no filter bar to draw.
		expect(html).not.toContain('Filter by source');
	});

	it('lists each item with a link, source, and timestamp', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
		vi.mocked(listItems).mockResolvedValue([
			row({ id: 2, title: 'Newest', url: 'https://example.com/new', source: 'ieee-spectrum', published_at: 5000 }),
			row({ id: 1, title: 'No date', url: 'https://example.com/old', published_at: null, fetched_at: 3000 }),
		]);

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
	});

	it('falls back to the raw slug and the neutral flag for an unregistered source', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['mystery-wire']);
		vi.mocked(listItems).mockResolvedValue([
			row({ source: 'mystery-wire', title: 'Unknown source' }),
		]);

		const html = await render();
		expect(html).toContain('mystery-wire');
		expect(html).toContain('bg-muted');
	});

	it('drops read items into a Read section with an un-read control', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		vi.mocked(listItems).mockResolvedValue([
			row({ id: 2, title: 'Still unread', read_at: null }),
			row({ id: 1, title: 'Already read', read_at: 4000 }),
		]);

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

	it('wires up the read/unread move animation: client router + per-item morph targets', async () => {
		vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
		vi.mocked(listItems).mockResolvedValue([
			row({ id: 2, title: 'Still unread', read_at: null }),
			row({ id: 1, title: 'Already read', read_at: 4000 }),
		]);

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
		vi.mocked(listItems).mockResolvedValue([
			row({ id: 1, title: 'Read one', read_at: 4000 }),
		]);

		const html = await render();
		expect(html).toMatch(/>\s*Read\s*</);
		expect(html).toContain('aria-label="Mark as unread"');
		expect(html).not.toContain('aria-label="Mark as read"');
	});

	describe('source filter bar', () => {
		it('renders a chip per present source with name + swatch, plus an All reset', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			vi.mocked(listItems).mockResolvedValue([row({})]);

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
			expect(vi.mocked(listItems).mock.calls[0][2]).toEqual([]);
		});

		it('marks the selected source active and narrows the query to it', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum']);
			vi.mocked(listItems).mockResolvedValue([row({ source: 'ieee-spectrum' })]);

			const html = await render('https://news.test/?source=ieee-spectrum');
			// listItems is called with the active source list.
			expect(vi.mocked(listItems).mock.calls[0][2]).toEqual(['ieee-spectrum']);
			// The active chip carries aria-current; the inactive chip's href toggles
			// it on (adds its slug to the selection) for multi-select without JS.
			expect(html).toMatch(/aria-current="true"/);
			expect(html).toContain('source=cloudflare-blog');
			expect(html).toContain('source=ieee-spectrum');
		});

		it('supports multi-select via repeated ?source params', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog', 'ieee-spectrum', 'apple']);
			vi.mocked(listItems).mockResolvedValue([row({})]);

			await render('https://news.test/?source=cloudflare-blog&source=apple');
			expect(vi.mocked(listItems).mock.calls[0][2]).toEqual(['cloudflare-blog', 'apple']);
		});

		it('treats an unknown ?source as All (filtered out, never a 500)', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			vi.mocked(listItems).mockResolvedValue([row({})]);

			const html = await render('https://news.test/?source=does-not-exist');
			// The unknown slug is dropped, so the query runs unfiltered ("All").
			expect(vi.mocked(listItems).mock.calls[0][2]).toEqual([]);
			// The All reset is the active chip.
			expect(html).toMatch(/href="\/"[^>]*aria-current="true"[^>]*>All</);
		});

		it('shows a per-source empty state when the selection has no items', async () => {
			vi.mocked(distinctSources).mockResolvedValue(['cloudflare-blog']);
			vi.mocked(listItems).mockResolvedValue([]);

			const html = await render('https://news.test/?source=cloudflare-blog');
			// Not the global empty state — the filter bar still shows so the reader
			// can clear the selection.
			expect(html).not.toContain('Nothing aggregated yet');
			expect(html).toContain('Nothing here from this source yet');
			expect(html).toContain('Filter by source');
		});
	});
});
