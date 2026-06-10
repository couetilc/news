import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import Index from '../src/pages/index.astro';

describe('index page', () => {
	it('renders the hello-world greeting', async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(Index);

		expect(html).toMatch(/<h1[^>]*>Hello, news!<\/h1>/);
		expect(html).toContain('Your personal news aggregator.');
	});

	it('stamps the render time as a valid ISO timestamp', async () => {
		const container = await AstroContainer.create();
		const html = await container.renderToString(Index);

		const match = html.match(/datetime="([^"]+)"/);
		expect(match).not.toBeNull();
		expect(new Date(match![1]).toISOString()).toBe(match![1]);
	});
});
