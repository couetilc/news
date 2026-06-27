import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it } from 'vitest';

import PinnedLinks from '../src/components/PinnedLinks.astro';
import { PINNED, type PinnedLink } from '../src/lib/pinned';

// PinnedLinks renders the owner-curated "pinned references" lane (#316) — a small
// typed list of always-present reference documents shown above the source filter.
// It renders via Astro's Container API in the node project (the same pattern as
// test/layout.test.ts). We assert the observable contract the design demands:
// the link's destination, label, external-link safety attributes, the PDF
// affordance, and the self-erasing empty state — not just that markup executes.
const render = (links: PinnedLink[]) =>
	AstroContainer.create().then((c) => c.renderToString(PinnedLinks, { props: { links } }));

// Pull the <a> open tag for a given href so per-attribute assertions check the
// anchor itself (its target/rel/class), not some other element on the page.
const anchorFor = (html: string, href: string): string => {
	const open = html.indexOf(`<a href="${href}"`);
	expect(open).toBeGreaterThan(-1);
	const close = html.indexOf('>', open);
	expect(close).toBeGreaterThan(open);
	return html.slice(open, close + 1);
};

describe('PinnedLinks (#316)', () => {
	it('renders nothing when there are no pinned links (self-erasing strip)', async () => {
		const html = await render([]);
		// No label, no nav landmark, no orphaned rule when the list is empty.
		expect(html).not.toContain('Pinned references');
		expect(html).not.toContain('>Pinned<');
		expect(html.trim()).toBe('');
	});

	it('renders an external PDF link with a safe target/rel and a PDF affordance', async () => {
		const link: PinnedLink = {
			label: 'Trump Policy Impact Tracker',
			href: 'https://example.com/doc.pdf',
			pdf: true,
		};
		const html = await render([link]);

		// It's inside a labeled "Pinned references" nav so it reads as a distinct lane.
		expect(html).toContain('aria-label="Pinned references"');
		// The small-caps "Pinned" label sets the lane apart from the source chips.
		expect(html).toContain('>Pinned<');

		// The link points at the document and shows its label.
		expect(html).toContain('href="https://example.com/doc.pdf"');
		expect(html).toContain('Trump Policy Impact Tracker');

		// External link: opens in a new tab with the safe rel (no opener leak).
		const anchor = anchorFor(html, 'https://example.com/doc.pdf');
		expect(anchor).toContain('target="_blank"');
		expect(anchor).toContain('rel="noopener noreferrer"');

		// The four #129 text-link affordances on the anchor: a resting underline,
		// accent on hover, the focus-visible ink ring, and cursor-pointer (native to
		// <a href>, so not asserted as a class).
		expect(anchor).toContain('underline');
		expect(anchor).toContain('hover:text-accent');
		expect(anchor).toContain('focus-visible:outline-ink');

		// A PDF target gets the small "PDF" format affordance (its own ruled tag —
		// Astro may pad the element's text with whitespace, so match it tolerantly).
		expect(html).toMatch(/>\s*PDF\s*</);
	});

	it('omits the PDF affordance for a non-PDF link', async () => {
		const html = await render([{ label: 'A web reference', href: 'https://example.com/page' }]);
		expect(html).toContain('href="https://example.com/page"');
		expect(html).toContain('A web reference');
		// No "PDF" tag when the entry isn't flagged as a PDF.
		expect(html).not.toMatch(/>\s*PDF\s*</);
	});

	it('renders every entry it is given, one list row per link', async () => {
		const html = await render([
			{ label: 'First', href: 'https://example.com/1' },
			{ label: 'Second', href: 'https://example.com/2', pdf: true },
		]);
		expect(html).toContain('href="https://example.com/1"');
		expect(html).toContain('href="https://example.com/2"');
		expect(html).toContain('First');
		expect(html).toContain('Second');
		// One <li> per link (the nav uses a <ul> of rows).
		expect((html.match(/<li/g) ?? []).length).toBe(2);
	});

	it('renders the real PINNED registry: the Trump Policy Impact Tracker PDF (#316)', async () => {
		// Exercise the shipped data module, not just a fixture — the canonical URL
		// (Teams-share artifact stripped) and the PDF flag are the contract this
		// issue delivers.
		const html = await render(PINNED);
		expect(html).toContain('Trump Policy Impact Tracker');
		expect(html).toContain(
			'href="https://assets.jpmprivatebank.com/content/dam/jpm-pb-aem/global/en/documents/eotm/trump-tracker.pdf"',
		);
		// No leftover Teams-share artifact on the canonical URL.
		expect(html).not.toContain('secureweb=Teams');
		expect(html).toMatch(/>\s*PDF\s*</);
	});
});

describe('PINNED registry (#316)', () => {
	it('contains exactly the Trump Policy Impact Tracker PDF entry today', () => {
		expect(PINNED).toHaveLength(1);
		const [entry] = PINNED;
		expect(entry.label).toBe('Trump Policy Impact Tracker');
		expect(entry.href).toBe(
			'https://assets.jpmprivatebank.com/content/dam/jpm-pb-aem/global/en/documents/eotm/trump-tracker.pdf',
		);
		expect(entry.pdf).toBe(true);
		// Canonical URL: the ?secureweb=Teams share artifact is stripped.
		expect(entry.href).not.toContain('secureweb');
	});
});
