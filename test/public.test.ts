import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listItems } from '../src/ingest/db';
import type { ItemRow } from '../src/ingest/db';

vi.mock('../src/ingest/db', () => ({ listItems: vi.fn() }));

import Public from '../src/pages/public.astro';

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

const render = async () => {
	const container = await AstroContainer.create();
	return container.renderToString(Public);
};

describe('public read-only feed page', () => {
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
		expect(html).toContain('IEEE Spectrum');
		expect(html).toContain('bg-source-ieee');
		expect(html).toContain(`datetime="${new Date(5000 * 1000).toISOString()}"`);
		expect(html).toContain(`datetime="${new Date(3000 * 1000).toISOString()}"`);
	});

	it('renders no write control: no /api/read form and no read/unread toggle', async () => {
		// The defining constraint of the public page: it cannot trigger a DB write.
		// A previously-read item (read_at set) would on the homepage draw an
		// un-read toggle and dim the row — here it must do neither.
		vi.mocked(listItems).mockResolvedValue([
			row({ id: 2, title: 'Fresh', read_at: null }),
			row({ id: 1, title: 'Read by Connor', read_at: 4000 }),
		]);

		const html = await render();
		// Both items render...
		expect(html).toContain('Fresh');
		expect(html).toContain('Read by Connor');
		// ...but nothing that POSTs: no form, no toggle, no Read section, and no
		// private read-state dimming.
		expect(html).not.toContain('action="/api/read"');
		expect(html).not.toContain('<form');
		expect(html).not.toContain('aria-label="Mark as read"');
		expect(html).not.toContain('aria-label="Mark as unread"');
		expect(html).not.toMatch(/>\s*Read\s*</);
		expect(html).not.toContain('opacity-55');
	});
});
