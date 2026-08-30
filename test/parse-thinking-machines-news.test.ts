import { describe, expect, it } from 'vitest';
import { parseThinkingMachinesNews } from '../src/ingest/parse/thinking-machines-news';
import listingHtml from './fixtures/thinking-machines-news.html?raw';

// #352 — Thinking Machines /news/ announcements. No feed covers the section
// (first-party /news/index.xml 404s, the root feed is blog-only, OpenRSS
// returns an empty channel), so parseThinkingMachinesNews reads the
// server-rendered /news/ listing instead: one row anchor (class
// post-item-link) per post with the title in the row's <h2 class="post-title">,
// a DATE-ONLY <time datetime="YYYY-MM-DD">, and a site-relative href. Rows
// carry no teaser → summary and contentHtml are null and the reader links out.
// The fixture is the live listing trimmed to shape: the site header/nav, the
// full 12-row post-group listing, and the footer whose /news/ article links
// carry NO row class — see the fixture's leading comment.

describe('parseThinkingMachinesNews — real /news/ listing fixture', () => {
	const items = parseThinkingMachinesNews(listingHtml);

	it('emits one item per listing row', () => {
		expect(items).toHaveLength(12);
		// Every row is a distinct announcement — permalink guids, no repeats.
		expect(new Set(items.map((i) => i.guid)).size).toBe(12);
	});

	it('extracts the listing in document order (newest first), by slug', () => {
		expect(items.map((i) => i.url)).toEqual([
			'https://thinkingmachines.ai/news/putting-task-expertise-into-rl/',
			'https://thinkingmachines.ai/news/safety-research-grants/',
			'https://thinkingmachines.ai/news/inkling-small/',
			'https://thinkingmachines.ai/news/introducing-inkling/',
			'https://thinkingmachines.ai/news/learning-to-replicate-expert-judgment-in-financial-tasks/',
			'https://thinkingmachines.ai/news/interactivity-research-grants/',
			'https://thinkingmachines.ai/news/training-llms-to-predict-world-events/',
			'https://thinkingmachines.ai/news/nvidia-partnership/',
			'https://thinkingmachines.ai/news/tinker-general-availability/',
			'https://thinkingmachines.ai/news/call-for-community-projects/',
			'https://thinkingmachines.ai/news/tinker-research-and-teaching-grants/',
			'https://thinkingmachines.ai/news/announcing-tinker/',
		]);
	});

	it('yields the full ParsedItem shape for a row: absolute link-out, no body, midnight-UTC date', () => {
		expect(items[0]).toEqual({
			guid: 'https://thinkingmachines.ai/news/putting-task-expertise-into-rl/',
			url: 'https://thinkingmachines.ai/news/putting-task-expertise-into-rl/',
			title:
				'Putting Task Expertise into RL Achieves State-of-the-Art Performance on Text-to-SQL',
			summary: null,
			contentHtml: null,
			// <time datetime="2026-08-27"> — date-only, so exactly midnight UTC.
			publishedAt: Math.floor(Date.UTC(2026, 7, 27) / 1000),
		});
	});

	it('parses each row date from the <time datetime> attribute, not the display text', () => {
		// "Oct 1, 2025" displays, but the attr is the machine-readable 2025-10-01.
		expect(items[11].title).toBe('Announcing Tinker');
		expect(items[11].publishedAt).toBe(Math.floor(Date.UTC(2025, 9, 1) / 1000));
	});

	it('skips nav/footer anchors — the footer links /news/ articles without the row class', () => {
		// The fixture's footer links /news/introducing-inkling/ and /news/
		// inkling-small/ as plain classless anchors, and the header nav links
		// /news/ itself; none become items (12 rows, not 14+).
		expect(items.every((i) => /^https:\/\/thinkingmachines\.ai\/news\/[a-z-]+\/$/.test(i.url))).toBe(
			true,
		);
		expect(items.some((i) => i.url === 'https://thinkingmachines.ai/news/')).toBe(false);
	});
});

describe('parseThinkingMachinesNews — edge cases and the parser-robustness contract (#165)', () => {
	// Minimal listing scaffolding: wrap row markup in a post-group container
	// (the recognizer the documented guard checks for).
	const wrap = (rows: string) => `<ol class="post-group" reversed>${rows}</ol>`;
	const row = (href: string, inner: string) =>
		`<li><a class="post-item-link" href="${href}">${inner}</a></li>`;

	it('throws the documented rejection on a document with no post-group container', () => {
		// The live failure modes this guards: an error page, a bot challenge, a
		// site redesign — recognizably not the listing.
		const errorPage =
			'<!DOCTYPE html><html><head><title>Attention Required!</title></head><body><main><a href="/">Home</a></main></body></html>';
		expect(() => parseThinkingMachinesNews(errorPage)).toThrow(
			/not a Thinking Machines news listing/,
		);
		expect(() => parseThinkingMachinesNews('')).toThrow(
			/not a Thinking Machines news listing: missing the post-group container/,
		);
		expect(() => parseThinkingMachinesNews(errorPage)).not.toThrow(TypeError);
	});

	it('returns no items for a listing whose container holds no rows (legit empty section)', () => {
		expect(parseThinkingMachinesNews(wrap(''))).toEqual([]);
	});

	it('skips a row anchor with no href, and one with an empty href (nothing to dedupe on)', () => {
		const html = wrap(
			'<li><a class="post-item-link"><h2>No link</h2></a></li>' +
				'<li><a class="post-item-link" href=""><h2>Blank link</h2></a></li>' +
				row('/news/kept/', '<h2>Kept</h2>'),
		);
		const items = parseThinkingMachinesNews(html);
		expect(items.map((i) => i.title)).toEqual(['Kept']);
	});

	it('skips a truncated row (open anchor with no closing </a>)', () => {
		const html = wrap(
			row('/news/whole/', '<h2>Whole</h2>') +
				'<li><a class="post-item-link" href="/news/cut/"><h2>Cut off',
		);
		const items = parseThinkingMachinesNews(html);
		expect(items.map((i) => i.url)).toEqual(['https://thinkingmachines.ai/news/whole/']);
	});

	it('passes an already-absolute href through unchanged (no double origin prefix)', () => {
		const items = parseThinkingMachinesNews(
			wrap(row('https://thinkingmachines.ai/news/abs/', '<h2>Abs</h2>')),
		);
		expect(items[0].url).toBe('https://thinkingmachines.ai/news/abs/');
		expect(items[0].url).not.toContain('thinkingmachines.aihttps');
		// Plain http:// counts as absolute too (the scheme test is https?).
		const httpItems = parseThinkingMachinesNews(
			wrap(row('http://thinkingmachines.ai/news/plain/', '<h2>P</h2>')),
		);
		expect(httpItems[0].url).toBe('http://thinkingmachines.ai/news/plain/');
	});

	it('prefixes a relative href even when a URL appears later inside it (anchored scheme test)', () => {
		// The absolute-vs-relative check must be anchored at the start: a relative
		// path that merely CONTAINS "https://" (e.g. in a query param) is still
		// relative and gets the origin prefix.
		const items = parseThinkingMachinesNews(wrap(row('/news/x?u=https://example.com', '<h2>Q</h2>')));
		expect(items[0].url).toBe('https://thinkingmachines.ai/news/x?u=https://example.com');
	});

	it('leaves publishedAt null when <time> is missing or its value is unparseable', () => {
		const noTime = parseThinkingMachinesNews(wrap(row('/news/a/', '<h2>A</h2>')));
		expect(noTime[0].publishedAt).toBeNull();
		const junkTime = parseThinkingMachinesNews(
			wrap(row('/news/b/', '<h2>B</h2><time datetime="someday">someday</time>')),
		);
		expect(junkTime[0].publishedAt).toBeNull();
	});

	it('reads a React-style dateTime= attribute spelling too (i-flag tolerance)', () => {
		const [item] = parseThinkingMachinesNews(
			wrap(row('/news/camel/', '<h2>C</h2><time dateTime="2026-08-24">Aug 24, 2026</time>')),
		);
		expect(item.publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 24) / 1000));
	});

	it('defaults the title to an empty string when the row has no <h2>', () => {
		const [item] = parseThinkingMachinesNews(
			wrap(row('/news/untitled/', '<time datetime="2026-08-24">x</time>')),
		);
		expect(item.title).toBe('');
	});

	it('treats a whitespace/markup-only <h2> as an empty title', () => {
		const [item] = parseThinkingMachinesNews(wrap(row('/news/blank/', '<h2> <em> </em> </h2>')));
		expect(item.title).toBe('');
	});

	it('strips inline markup and decodes entities in the title (#224)', () => {
		const [item] = parseThinkingMachinesNews(
			wrap(row('/news/fancy/', '<h2>Grants &amp; more: <em>Caf&#xe9;</em> edition</h2>')),
		);
		expect(item.title).toBe('Grants & more: Café edition');
	});
});
