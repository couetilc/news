import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listItems } from '../src/ingest/db';
import type { ItemRow } from '../src/ingest/db';

vi.mock('../src/ingest/db', () => ({ listItems: vi.fn() }));

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
	...over,
});

const render = async () => {
	const container = await AstroContainer.create();
	return container.renderToString(Index);
};

describe('index page', () => {
	afterEach(() => vi.mocked(listItems).mockReset());

	it('shows an empty state when nothing has been aggregated', async () => {
		vi.mocked(listItems).mockResolvedValue([]);
		expect(await render()).toContain('Nothing aggregated yet');
	});

	it('lists each item with a link, source, and timestamp', async () => {
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
	});

	it('falls back to the raw slug and the neutral flag for an unregistered source', async () => {
		vi.mocked(listItems).mockResolvedValue([
			row({ source: 'mystery-wire', title: 'Unknown source' }),
		]);

		const html = await render();
		expect(html).toContain('mystery-wire');
		expect(html).toContain('bg-muted');
	});
});
