import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import Forbidden from '../src/pages/403.astro';

// The in-voice 403 page (issue #95). The middleware turns a forbidden cross-site
// form POST into a `rewrite('/403')`, which renders this route as the response —
// so the page is responsible for the 403 status and the newsprint-voice copy
// (replacing Astro's bare plaintext "Cross-site POST form submissions are
// forbidden"). The middleware's *decision* to rewrite is covered in
// middleware.test.ts; here we pin the rendered page itself.
const render = () =>
	AstroContainer.create().then((c) => c.renderToResponse(Forbidden));

describe('403 forbidden page', () => {
	it('renders with a 403 status', async () => {
		const res = await render();
		expect(res.status).toBe(403);
	});

	it('surfaces an in-voice cross-site explanation, not raw plaintext', async () => {
		const html = await (await render()).text();
		// The 403 label and a human heading — not Astro's bare default string.
		expect(html).toContain('403 · Forbidden');
		expect(html).not.toContain('Cross-site POST form submissions are forbidden');
		// The reason is rendered in the shared role="alert" voice (AuthForm idiom),
		// naming the same-origin requirement so the reader understands the rejection.
		expect(html).toContain('role="alert"');
		expect(html).toContain('news.cuteteal.com');
		// A way back into the flow.
		expect(html).toContain('href="/login"');
	});

	it('renders inside the shared newspaper layout (masthead chrome)', async () => {
		const html = await (await render()).text();
		// The Layout masthead nameplate, so the error stays on-brand.
		expect(html).toContain('All the feeds fit to print');
		expect(html).toContain('<title>Forbidden · News</title>');
	});
});
