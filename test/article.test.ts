import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';
import type { ItemRow } from '../src/ingest/db';
import Article from '../src/components/Article.astro';

const row = (over: Partial<ItemRow> = {}): ItemRow => ({
	id: 7,
	source: 'cloudflare-blog',
	guid: 'g',
	url: 'https://example.com/a',
	title: 'A headline',
	summary: null,
	content_html: null,
	published_at: 1000,
	fetched_at: 2000,
	read_at: null,
	...over,
});

const render = async (props: { item: ItemRow; interactive?: boolean; returnTo?: string }) => {
	const container = await AstroContainer.create();
	// Article is an <li>; render it standalone to inspect just the row.
	return container.renderToString(Article, { props });
};

describe('Article component', () => {
	it('renders the read/unread write form by default (interactive)', async () => {
		const html = await render({ item: row() });
		expect(html).toContain('A headline');
		// The interactive row carries the POST control to /api/read.
		expect(html).toContain('<form method="POST" action="/api/read"');
		expect(html).toContain('aria-label="Mark as read"');
		// With no returnTo passed, the toggle defaults to returning home.
		expect(html).toContain('name="return" value="/"');
	});

	it('carries the current view as the toggle\'s return target (#80)', async () => {
		// The homepage passes its current path+query so flipping this item lands
		// the reader back on the same filtered/paginated view (validated server-side).
		const html = await render({ item: row(), returnTo: '/?source=ieee-spectrum&unread=2&read=3' });
		expect(html).toContain(
			'name="return" value="/?source=ieee-spectrum&amp;unread=2&amp;read=3"',
		);
	});

	it('omits every write control when interactive is false', async () => {
		// Same item, read-only: no form, no toggle — nothing that mutates D1. This
		// is the public feed's row (issue #49).
		const html = await render({ item: row(), interactive: false });
		expect(html).toContain('A headline');
		expect(html).not.toContain('<form');
		expect(html).not.toContain('action="/api/read"');
		expect(html).not.toContain('aria-label="Mark as read"');
	});

	it('does not dim a read item or draw an un-read control when read-only', async () => {
		// read_at is Connor's private state; the public row ignores it entirely —
		// no opacity dimming, no inverse toggle.
		const html = await render({ item: row({ read_at: 4000 }), interactive: false });
		expect(html).not.toContain('opacity-55');
		expect(html).not.toContain('aria-label="Mark as unread"');
		expect(html).not.toContain('<form');
	});
});
