import { describe, expect, it } from 'vitest';
import { parseCursorBlog } from '../src/ingest/parse/cursor';
import listingHtml from './fixtures/cursor-blog-research.html?raw';

// #335 — Cursor blog, research topic. The official cursor.com/rss.xml is dead
// (stale since ~Sept 2025; by 2026-08 the URL serves the marketing homepage as
// text/html), so parseCursorBlog reads the server-rendered /blog/topic/research
// listing instead: one card anchor (class blog-directory__row) per post with
// the title in the card's only <p>, the date in <time dateTime="…">, and a
// site-relative href. Cards carry no teaser → summary and contentHtml are null
// and the reader links out. The fixture is the live listing trimmed to shape:
// the full first SSR render (12 cards), one RSC flight <script> blob, and the
// first two cards of the page's SECOND (duplicate) render — see the fixture's
// leading comment.

describe('parseCursorBlog — real research-listing fixture', () => {
	const items = parseCursorBlog(listingHtml);

	it('emits one item per card anchor, including the duplicate SSR render', () => {
		// 12 cards in the first render + the 2 that open the duplicate render.
		// The duplicates are deliberate parser output: insertItems collapses them
		// on (source, guid) — the designed dedupe point (#191).
		expect(items).toHaveLength(14);
		expect(new Set(items.map((i) => i.guid)).size).toBe(12);
		// The duplicate render repeats the first render's cards exactly.
		expect(items[12]).toEqual(items[0]);
		expect(items[13]).toEqual(items[1]);
	});

	it('extracts the first render in listing order (newest first), by slug', () => {
		expect(items.slice(0, 12).map((i) => i.url)).toEqual([
			'https://cursor.com/blog/git-at-any-scale',
			'https://cursor.com/blog/grok-4-6',
			'https://cursor.com/blog/how-cursor-router-works',
			'https://cursor.com/blog/mixture-of-kittens',
			'https://cursor.com/blog/cloud-agent-environment',
			'https://cursor.com/blog/agent-swarm-model-economics',
			'https://cursor.com/blog/grok-4-5-model-card',
			'https://cursor.com/blog/grok-4-5',
			'https://cursor.com/blog/reward-hacking-coding-benchmarks',
			'https://cursor.com/blog/agent-autonomy-auto-review',
			'https://cursor.com/blog/cloud-agent-lessons',
			'https://cursor.com/blog/composer-2-5',
		]);
	});

	it('yields the full ParsedItem shape for a card: absolute link-out, no body, ISO date', () => {
		expect(items[0]).toEqual({
			guid: 'https://cursor.com/blog/git-at-any-scale',
			url: 'https://cursor.com/blog/git-at-any-scale',
			title: 'Git at any scale',
			summary: null,
			contentHtml: null,
			// <time dateTime="2026-08-18T12:00:00.000Z">.
			publishedAt: Math.floor(Date.UTC(2026, 7, 18, 12, 0, 0) / 1000),
		});
	});

	it('parses each card date from the <time dateTime> attribute, not the display text', () => {
		// A midnight-UTC card ("Aug 12, 2026" displays, but the attr is precise).
		expect(items[1].title).toBe('Introducing Grok 4.6');
		expect(items[1].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 12, 0, 0, 0) / 1000));
	});

	it('keeps non-ASCII title text intact (UTF-8, not entity-mangled)', () => {
		expect(items[10].title).toBe('What we’ve learned building cloud agents');
	});

	it('skips non-card anchors (breadcrumbs) and the RSC flight script blob', () => {
		// The fixture's header carries a real <a href="/blog">Blog</a> breadcrumb
		// (twice) and a self.__next_f.push flight <script>; none become items.
		expect(items.every((i) => i.url.startsWith('https://cursor.com/blog/'))).toBe(true);
		expect(items.some((i) => i.url === 'https://cursor.com/blog')).toBe(false);
	});
});

describe('parseCursorBlog — edge cases and the parser-robustness contract (#165)', () => {
	// Minimal listing scaffolding: wrap card markup in a blog-directory container
	// (the recognizer the documented guard checks for).
	const wrap = (cards: string) => `<div class="blog-directory"><div>${cards}</div></div>`;
	const card = (href: string, inner: string) =>
		`<a class="blog-directory__row block" href="${href}"><article>${inner}</article></a>`;

	it('throws the documented rejection on a document with no blog-directory container', () => {
		// The live failure mode this guards: the dead rss.xml URL 200s with the
		// marketing homepage — recognizably not the listing.
		const homepage =
			'<!DOCTYPE html><html><head><title>Cursor - The best way to code with AI</title></head><body><main><a href="/pricing">Pricing</a></main></body></html>';
		expect(() => parseCursorBlog(homepage)).toThrow(/not a Cursor blog listing/);
		expect(() => parseCursorBlog('')).toThrow(
			/not a Cursor blog listing: missing the blog-directory container/,
		);
		expect(() => parseCursorBlog(homepage)).not.toThrow(TypeError);
	});

	it('returns no items for a listing whose container holds no cards (legit empty topic)', () => {
		expect(parseCursorBlog(wrap(''))).toEqual([]);
	});

	it('skips a card anchor with no href, and one with an empty href (nothing to dedupe on)', () => {
		const html = wrap(
			'<a class="blog-directory__row"><p>No link</p></a>' +
				'<a class="blog-directory__row" href=""><p>Blank link</p></a>' +
				card('/blog/kept', '<p>Kept</p>'),
		);
		const items = parseCursorBlog(html);
		expect(items.map((i) => i.title)).toEqual(['Kept']);
	});

	it('skips a truncated card (open anchor with no closing </a>)', () => {
		const html = wrap(
			card('/blog/whole', '<p>Whole</p>') +
				'<a class="blog-directory__row" href="/blog/cut"><article><p>Cut off',
		);
		const items = parseCursorBlog(html);
		expect(items.map((i) => i.url)).toEqual(['https://cursor.com/blog/whole']);
	});

	it('passes an already-absolute href through unchanged (no double origin prefix)', () => {
		const items = parseCursorBlog(wrap(card('https://cursor.com/blog/abs', '<p>Abs</p>')));
		expect(items[0].url).toBe('https://cursor.com/blog/abs');
		expect(items[0].url).not.toContain('cursor.comhttps');
	});

	it('leaves publishedAt null when <time> is missing or its value is unparseable', () => {
		const noTime = parseCursorBlog(wrap(card('/blog/a', '<p>A</p>')));
		expect(noTime[0].publishedAt).toBeNull();
		const junkTime = parseCursorBlog(
			wrap(card('/blog/b', '<time dateTime="someday">someday</time><p>B</p>')),
		);
		expect(junkTime[0].publishedAt).toBeNull();
	});

	it('defaults the title to an empty string when the card has no <p>', () => {
		const [item] = parseCursorBlog(
			wrap(card('/blog/untitled', '<time dateTime="2026-08-18T12:00:00.000Z">x</time>')),
		);
		expect(item.title).toBe('');
	});

	it('treats a whitespace/markup-only <p> as an empty title', () => {
		const [item] = parseCursorBlog(wrap(card('/blog/blank', '<p> <em> </em> </p>')));
		expect(item.title).toBe('');
	});

	it('strips inline markup and decodes entities in the title (#224)', () => {
		const [item] = parseCursorBlog(
			wrap(card('/blog/fancy', '<p>Speed &amp; scale: <em>Caf&#xe9;</em> mode</p>')),
		);
		expect(item.title).toBe('Speed & scale: Café mode');
	});
});
