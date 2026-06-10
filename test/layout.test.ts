import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import Layout from '../src/layouts/Layout.astro';

describe('base layout', () => {
	it('renders the title and slotted content', async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(Layout, {
			props: { title: 'Test Title' },
			slots: { default: '<p>slotted content</p>' },
		});

		expect(html).toContain('<title>Test Title</title>');
		expect(html).toContain('<p>slotted content</p>');
	});
});
