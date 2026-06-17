import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import Layout from '../src/layouts/Layout.astro';

// Layout owns the masthead, and the session control lives there now (issue #128).
// It's a shared/generic layout (/, /login, /signup…), so it reads the auth state
// off Astro.locals.userId — the one typed place the middleware sets it (#70) —
// and renders the matching affordance: a POST-to-/logout Sign out form when a
// user is logged in, a Log in link when not. The Container API has no
// middleware/session of its own, so we inject `locals` to drive each branch (the
// same way the index-page tests do). A `<slot>` is supplied so the render is a
// realistic page.
const render = (locals: App.Locals) =>
	AstroContainer.create().then((c) =>
		c.renderToString(Layout, {
			props: { title: 'News' },
			locals,
			slots: { default: '<p>feed body</p>' },
		}),
	);

describe('Layout masthead session control (#128)', () => {
	it('renders Sign out (POST /logout) in the masthead when a user is logged in', async () => {
		const html = await render({ userId: 7 });

		// The action-button idiom: the Sign out control is a real POST form so it
		// still logs out with JS off (POST /logout → 303 redirect, behavior
		// unchanged — just relocated from the feed body).
		expect(html).toContain('Sign out');
		expect(html).toContain('action="/logout"');
		expect(html).toContain('method="POST"');
		// A drawn resting affordance (border), the hover state, the focus-visible
		// ring, and cursor-pointer — the four #129 obligations of a control.
		expect(html).toContain('border border-ink');
		expect(html).toContain('hover:bg-ink');
		expect(html).toContain('focus-visible:outline-ink');
		expect(html).toContain('cursor-pointer');
		// The disable-on-submit async enhancement (#96): the button carries the
		// data hooks + disabled:* utilities the client script reads. The script's
		// behavior is e2e-tested; here we pin that the markup hooks are present.
		expect(html).toContain('data-logout-submit');
		expect(html).toContain('data-busy-label="Signing out…"');
		expect(html).toContain('disabled:opacity-60');
		// The logged-in masthead never shows the anonymous Log in link.
		expect(html).not.toContain('Log in');
		expect(html).not.toContain('href="/login"');
		// The page's slotted content still renders.
		expect(html).toContain('feed body');
	});

	it('renders a Log in link in the masthead for an anonymous request', async () => {
		const html = await render({});

		// The text-link idiom: navigation to /login with a resting underline,
		// accent on hover, and the focus-visible ring (#129).
		expect(html).toContain('Log in');
		expect(html).toContain('href="/login"');
		expect(html).toContain('underline');
		expect(html).toContain('hover:text-accent');
		expect(html).toContain('focus-visible:outline-ink');
		// Anonymous: no Sign out form in the masthead.
		expect(html).not.toContain('Sign out');
		expect(html).not.toContain('action="/logout"');
		expect(html).toContain('feed body');
	});

	it('keeps the nameplate centered with the control out of flow', async () => {
		// The control is absolutely positioned in the top-right corner so it never
		// offsets the centered dateline / "News" / tagline (the double-ruled,
		// text-center nameplate stays centered).
		const html = await render({ userId: 7 });
		expect(html).toContain('text-center');
		expect(html).toContain('border-double border-ink');
		expect(html).toContain('absolute');
	});
});

describe('Layout masthead colophon (#271, #272)', () => {
	it('carries the colophon line in the always-visible masthead, not a bottom footer', async () => {
		const html = await render({ userId: 7 });

		// #271: the colophon moved out of the bottom footer (which receded below
		// the infinite-scroll feed) into the masthead, so it reads on every page.
		expect(html).toContain('A personal news aggregator · news.cuteteal.com');

		// The bottom <footer> is gone — its content now lives in the masthead.
		expect(html).not.toContain('<footer');

		// It sits inside the masthead <header>, ahead of <main>, not after it: the
		// colophon precedes the slotted feed body in document order.
		const colophonAt = html.indexOf('A personal news aggregator');
		const mainAt = html.indexOf('<main');
		expect(colophonAt).toBeGreaterThan(-1);
		expect(mainAt).toBeGreaterThan(colophonAt);
	});

	it('links to the public /status page from the masthead colophon (text-link idiom #129)', async () => {
		const html = await render({ userId: 7 });

		// #272: a discreet "Status" text-link surfaces the otherwise-orphaned
		// public /status page.
		expect(html).toContain('href="/status"');
		expect(html).toContain('>Status</a>');

		// The text-link affordance: a resting underline, accent on hover, and the
		// focus-visible ring (#129), mirroring the masthead Log in link.
		const statusLink = html.slice(
			html.indexOf('href="/status"'),
			html.indexOf('>Status</a>'),
		);
		expect(statusLink).toContain('underline');
		expect(statusLink).toContain('hover:text-accent');
		expect(statusLink).toContain('focus-visible:outline-ink');
	});

	it('shows the colophon + Status link for anonymous visitors too', async () => {
		// /status is public (prerender=true, deploy metadata only), so the link is
		// fine to show whether or not a user is logged in. The shared Layout means
		// /login, /signup, /status all render it as well.
		const html = await render({});

		expect(html).toContain('A personal news aggregator · news.cuteteal.com');
		expect(html).toContain('href="/status"');
		expect(html).not.toContain('<footer');
	});
});
