import { describe, expect, it } from 'vitest';
import { parseInceptionBlog } from '../src/ingest/parse/inception';
import listing from './fixtures/inception-blog.html?raw';

const wrap = (body: string) => `<h1>Blog</h1>${body}`;
const dated = '<time datetime="2026-09-08T00:00:00.000Z">Sep 8</time>';
const card = (href = './blog/example', body = `<h6>Example</h6>${dated}`) => `<a href="${href}">${body}</a>`;

describe('parseInceptionBlog', () => {
	it('reads the featured release and regular responsive cards while excluding external press', () => {
		const items = parseInceptionBlog(listing);
		expect(items).toHaveLength(4);
		expect(items[0]).toEqual({
			guid: 'https://www.inceptionlabs.ai/blog/introducing-mercury-2-5',
			url: 'https://www.inceptionlabs.ai/blog/introducing-mercury-2-5',
			title: 'Introducing Mercury 2.5',
			publishedAt: Date.UTC(2026, 8, 8) / 1000,
			summary: null,
			contentHtml: null,
		});
		expect(items[1]).toEqual(items[2]);
		expect(items[1].title).toBe('Mercury 2 for Search: Fast enough to run a hundred times per query');
		expect(items[1].publishedAt).toBe(Date.UTC(2026, 7, 11) / 1000);
		expect(items[3].publishedAt).toBe(Date.UTC(2025, 10, 7) / 1000);
	});

	it('normalizes canonical URLs, heading markup, entities and whitespace', () => {
		const [item] = parseInceptionBlog('<h1 class="heading">\n Blog \n</h1 >' +
			`<A HREF='https://www.inceptionlabs.ai/blog/example/?utm_source=test&amp;x=y#top'>
			<H3 class="title"> Mercury <em>2.5</em>\n &amp; &#x41;I </H3><h6>Read story</h6>
			<TIME class="date" DATETIME='2026-09-08'></TIME></A>`,
		);
		expect(item.title).toBe('Mercury 2.5 & AI');
		expect(item.guid).toBe('https://www.inceptionlabs.ai/blog/example');
		expect(item.url).toBe(item.guid);
		expect(item.publishedAt).toBe(Date.UTC(2026, 8, 8) / 1000);
	});

	it('rejects wrong documents, but permits a recognized empty listing', () => {
		for (const html of ['', '<h1>Sign in</h1>', 'garbage', '<h1>Blog']) {
			expect(() => parseInceptionBlog(html)).toThrow(/^not an Inception blog listing/);
		}
		expect(parseInceptionBlog(wrap(''))).toEqual([]);
	});

	it('skips banners, absent links, malformed URLs, credentials, non-web and offsite destinations', () => {
		const rejected = ['https://[bad', 'javascript:alert(1)', 'https://example.com/blog/x',
			'https://www.inceptionlabs.ai.evil.test/blog/x', '/company', '/blog/',
			'/outside/blog/example', '/blog/example/other', '/blog/example.html',
			'https://user@www.inceptionlabs.ai/blog/x', 'https://:secret@www.inceptionlabs.ai/blog/x', ''];
		expect(parseInceptionBlog(wrap(rejected.map((href) => card(href)).join('')
			+ `<a>${dated}</a>` + card('/blog/banner', '<h3>Undated banner</h3>')))).toEqual([]);
	});

	it('exposes missing titles to the normal field-validation health signal', () => {
		const items = parseInceptionBlog(wrap(card('/blog/missing-title', dated)
			+ card('/blog/unclosed-title', '<h6>Unclosed' + dated)));
		expect(items.map((item) => [item.title, item.publishedAt])).toEqual([
			['', Date.UTC(2026, 8, 8) / 1000], ['', Date.UTC(2026, 8, 8) / 1000],
		]);
	});

	it('reports missing or invalid dates instead of silently losing articles to the backfill filter', () => {
		for (const time of ['<time>Yesterday</time>', '<time datetime="not-a-date"></time>']) {
			expect(() => parseInceptionBlog(wrap(card('/blog/missing-date', `<h6>Title</h6>${time}`))))
				.toThrow('not an Inception blog listing: card missing a valid date');
		}
	});

	it('does not borrow fields from a following card or repeatedly rescan malformed tails', () => {
		const items = parseInceptionBlog(wrap('</a><a href="/blog/unclosed"><h6>Wrong</h6>'
			+ card('/blog/right') + '</a><a href="/blog/truncated">' + dated));
		expect(items.map((item) => item.url)).toEqual(['https://www.inceptionlabs.ai/blog/right']);
		expect(parseInceptionBlog(wrap('<a href="/blog/unclosed">'.repeat(20_000)))).toEqual([]);
		expect(parseInceptionBlog(wrap('<a '.repeat(20_000)))).toEqual([]);
	});
});
