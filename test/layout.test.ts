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

// The session-control wrapper (#317) is the masthead's one positioned-on-sm div:
// it's the <div> whose class list carries `sm:absolute`. Find that <div>'s opening
// tag and return its class list as whitespace-delimited utility tokens, so a test
// can assert token-exact membership (a bare substring check can't tell `absolute`
// from `sm:absolute`).
const sessionControlWrapperClasses = (html: string): string[] => {
	const m = html.match(/<div class="([^"]*\bsm:absolute\b[^"]*)"/);
	expect(m).not.toBeNull();
	return (m as RegExpMatchArray)[1].split(/\s+/).filter(Boolean);
};

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

	it('keeps the nameplate centered and the session control responsive (#128, #317)', async () => {
		// The double-ruled, text-center nameplate stays centered, and the header is
		// `relative` so the sm:-absolute session control anchors to it.
		const html = await render({ userId: 7 });
		expect(html).toContain('text-center');
		expect(html).toContain('border-double border-ink');

		// The session-control wrapper is the masthead's only positioned-on-sm div.
		// Pull its class list and assert token-exact membership (#317): on mobile the
		// control is IN NORMAL FLOW (`flex justify-end`, its own line below the
		// nameplate) so it can't overlap the centered text, and only at sm:+ does it
		// switch BACK out of flow into the top-right corner (`sm:absolute …`). A bare
		// `absolute` substring check would no longer distinguish those — `sm:absolute`
		// contains the substring `absolute` — so split into utility tokens.
		const wrapperClasses = sessionControlWrapperClasses(html);
		// Mobile-first: in-flow, right-aligned, on its own line above the nameplate.
		expect(wrapperClasses).toContain('flex');
		expect(wrapperClasses).toContain('justify-end');
		expect(wrapperClasses).toContain('mb-1.5');
		// There is NO resting (unprefixed) `absolute` — the control is in flow on
		// mobile; absolute positioning is reserved for sm:+.
		expect(wrapperClasses).not.toContain('absolute');
		// At sm:+ it returns to the out-of-flow top-right corner, and the flow
		// layout is undone (`sm:block` overrides `flex`, `sm:mb-0` drops the line gap).
		expect(wrapperClasses).toContain('sm:absolute');
		expect(wrapperClasses).toContain('sm:right-4');
		expect(wrapperClasses).toContain('sm:top-3');
		expect(wrapperClasses).toContain('sm:block');
		expect(wrapperClasses).toContain('sm:mb-0');
	});

	it('puts the anonymous Log in link in the same responsive wrapper (#317)', async () => {
		// The Log in link shares the session-control corner, so the same mobile-flow
		// vs sm:-absolute wrapper must apply to it too (the issue calls out both
		// controls crowding the nameplate on mobile).
		const html = await render({});
		const wrapperClasses = sessionControlWrapperClasses(html);
		expect(wrapperClasses).toContain('flex');
		expect(wrapperClasses).toContain('justify-end');
		expect(wrapperClasses).not.toContain('absolute');
		expect(wrapperClasses).toContain('sm:absolute');
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

	// The dateline link's class list, split into whitespace-delimited utility
	// tokens. Token-exact membership is required because 'hover:underline' *contains*
	// the substring 'underline', so a substring check can no longer tell a resting
	// underline from a hover-only one (#308 made it hover-only).
	const datelineLinkClasses = (html: string) => {
		const link = datelineLink(html);
		const m = link.match(/class="([^"]*)"/);
		expect(m).not.toBeNull();
		return (m as RegExpMatchArray)[1].split(/\s+/).filter(Boolean);
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

		// The #129 text-link affordances minus one deliberate deviation (Connor's
		// #308 review): accent on hover, the focus-visible ring, cursor-pointer
		// (native to <a href>) — but the underline is HOVER-ONLY here, no resting
		// underline. Assert token-exact (not substring): 'hover:underline' is
		// present, and there is NO standalone resting 'underline' utility token.
		const classes = datelineLinkClasses(html);
		expect(classes).toContain('hover:underline');
		expect(classes).toContain('hover:underline-offset-2');
		expect(classes).not.toContain('underline');
		expect(classes).not.toContain('underline-offset-2');
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
		// Same hover-only underline contract for anonymous visitors (#305/#308).
		const classes = datelineLinkClasses(html);
		expect(classes).toContain('hover:underline');
		expect(classes).not.toContain('underline');
		expect(link).toContain('hover:text-accent');
		expect(link).toContain('focus-visible:outline-ink');
		// Anonymous render also drops the old colophon line + footer.
		expect(html).not.toContain('A personal news aggregator');
		expect(html).not.toContain('<footer');
	});
});

describe('Layout favicon links (#306)', () => {
	it('emits both the SVG and ICO brand-mark icon links', async () => {
		// The brand mark (#306) is the "N"-shaped magnet shipped as
		// public/favicon.svg (primary, modern) + public/favicon.ico (fallback).
		// The asset *design* is judged by eye in PR review (per the design-system
		// skill); this is the cheap structural guard that both <link rel="icon">
		// references the layout owns stay wired up so neither asset is orphaned.
		const html = await render({ userId: 7 });

		// Primary: the modern SVG icon, served with the right MIME type.
		expect(html).toContain('rel="icon" type="image/svg+xml"');
		expect(html).toContain('href="/favicon.svg"');

		// Fallback: the multi-size ICO for clients that don't take SVG favicons.
		expect(html).toContain('href="/favicon.ico"');
	});
});
