import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import Layout from '../src/layouts/Layout.astro';
import { longDate } from '../src/lib/format';

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

describe('Layout masthead dateline /status link (#305)', () => {
	// Extract the dateline <a href="/status">…</a> element (its open tag through
	// its close) so each assertion can check the affordance classes on the link
	// itself. The Layout's only /status link now is the dateline (the #271/#272
	// colophon line was removed in #305).
	const datelineLink = (html: string) => {
		const open = html.indexOf('<a href="/status"');
		expect(open).toBeGreaterThan(-1);
		const close = html.indexOf('</a>', open);
		expect(close).toBeGreaterThan(open);
		return html.slice(open, close);
	};

	it('drops the colophon line entirely — no aggregator copy, no bottom footer', async () => {
		const html = await render({ userId: 7 });

		// #305 reverses the #271/#272 colophon: the "A personal news aggregator ·
		// news.cuteteal.com · Status" line is gone from the masthead.
		expect(html).not.toContain('A personal news aggregator');
		expect(html).not.toContain('news.cuteteal.com');
		// There is no standalone ">Status</a>" text link anymore — the /status
		// destination is now reached through the dateline, not a "Status" word.
		expect(html).not.toContain('>Status</a>');
		// The masthead never reintroduced a bottom <footer> either.
		expect(html).not.toContain('<footer');
	});

	it("wraps the headline dateline in an /status link carrying the #129 text-link affordance", async () => {
		const html = await render({ userId: 7 });

		// The dateline date itself is the link text (today's longDate), inside an
		// <a href="/status"> — navigating it reaches the public status page.
		const link = datelineLink(html);
		expect(link).toContain('>' + longDate(new Date()));

		// The four #129 obligations of a text-link control: a resting underline
		// (cursor-pointer is native to <a href>), accent on hover, and the
		// focus-visible ring — mirroring the masthead Log in link's idiom.
		expect(link).toContain('underline');
		expect(link).toContain('hover:text-accent');
		expect(link).toContain('focus-visible:outline-ink');

		// It stays in the agate/uppercase masthead voice: the dateline <p> still
		// carries the small-caps, letter-spaced, muted font-sans treatment.
		const datelineP = html.slice(
			html.lastIndexOf('<p', html.indexOf('<a href="/status"')),
			html.indexOf('<a href="/status"'),
		);
		expect(datelineP).toContain('font-sans');
		expect(datelineP).toContain('uppercase');
		expect(datelineP).toContain('tracking-[0.3em]');
		expect(datelineP).toContain('text-muted');

		// The dateline link sits inside the masthead <header>, ahead of <main>.
		const linkAt = html.indexOf('<a href="/status"');
		const mainAt = html.indexOf('<main');
		expect(mainAt).toBeGreaterThan(linkAt);
	});

	it('shows the dateline /status link for anonymous visitors too', async () => {
		// /status is public (prerender=true, deploy metadata only), so the link is
		// fine to show whether or not a user is logged in. The shared Layout means
		// /login, /signup, /status all render it as well.
		const html = await render({});

		const link = datelineLink(html);
		expect(link).toContain('>' + longDate(new Date()));
		expect(link).toContain('underline');
		expect(link).toContain('hover:text-accent');
		expect(link).toContain('focus-visible:outline-ink');
		// Anonymous render also drops the old colophon line + footer.
		expect(html).not.toContain('A personal news aggregator');
		expect(html).not.toContain('<footer');
	});
});
