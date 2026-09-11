import { describe, expect, it } from 'vitest';
import { parseMetaAiResearch } from '../src/ingest/parse/meta-ai';
import listing from './fixtures/meta-ai-research.html?raw';

const wrap = (body: string) => `<div data-testid="home-content-column">${body}</div>`;
const card = (body: string) => `<article data-blog-post-summary="card">${body}</article>`;
const link = '<a href="/blog/example"><h2>Example</h2></a>';

describe('parseMetaAiResearch', () => {
	it('extracts featured and regular posts with canonical URLs and actual publication dates', () => {
		const items = parseMetaAiResearch(listing);
		expect(items.map((item) => [item.title, item.publishedAt])).toEqual([
			['Introducing Muse Spark 1.3', Date.UTC(2026, 8, 2) / 1000],
			['How We Built Safety Into Muse', Date.UTC(2026, 8, 8) / 1000],
			['Introducing Muse Voice Transcribe', Date.UTC(2026, 8, 1) / 1000],
		]);
		expect(items[2]).toEqual({
			guid: 'https://research.meta.ai/blog/introducing-muse-voice-transcribe',
			url: 'https://research.meta.ai/blog/introducing-muse-voice-transcribe',
			title: 'Introducing Muse Voice Transcribe',
			summary: null,
			contentHtml: null,
			publishedAt: Date.UTC(2026, 8, 1) / 1000,
		});
	});

	it('normalizes absolute URLs, tracking, trailing slashes, tags, entities and whitespace', () => {
		const items = parseMetaAiResearch(wrap(card(
			`<a href='https://research.meta.ai/blog/example/?utm_source=test&amp;x=y#demo'>
			 <h2>  Muse <em>Voice</em>\n &amp; &#x41;SR  </h2><time datetime='2026-09-01'></time></a>`,
		)));
		expect(items).toEqual([{
			guid: 'https://research.meta.ai/blog/example',
			url: 'https://research.meta.ai/blog/example',
			title: 'Muse Voice & ASR', summary: null, contentHtml: null,
			publishedAt: Date.UTC(2026, 8, 1) / 1000,
		}]);
	});

	it('keeps missing titles and dates visible to the ingest field validator', () => {
		expect(parseMetaAiResearch(wrap(card('<a href="/blog/example"></a>')))[0]).toEqual({
			guid: 'https://research.meta.ai/blog/example', url: 'https://research.meta.ai/blog/example',
			title: '', summary: null, contentHtml: null, publishedAt: null,
		});
		expect(parseMetaAiResearch(wrap(card(`${link}<time dateTime="invalid"></time>`)))[0].publishedAt)
			.toBeNull();
	});

	it('preserves older first-party ai.meta.com article destinations in the current listing', () => {
		const [item] = parseMetaAiResearch(wrap(card(
			'<a href="https://ai.meta.com/blog/introducing-muse-image-muse-video-msl/">'
			+ '<h2>Introducing Muse Image and Muse Video</h2><time dateTime="2026-07-07"></time></a>',
		)));
		expect(item.url).toBe('https://ai.meta.com/blog/introducing-muse-image-muse-video-msl');
		expect(item.guid).toBe(item.url);
		expect(item.title).toBe('Introducing Muse Image and Muse Video');
		expect(item.publishedAt).toBe(Date.UTC(2026, 6, 7) / 1000);
	});

	it.each([
		'<a>No href</a>', '<a href="">Empty</a>', '<a href="https://[invalid">Bad URL</a>',
		'<a href="https://example.com/blog/example">External</a>',
		'<a href="//example.com/blog/example">Protocol relative external</a>',
		'<a href="javascript:alert(1)">Non-web</a>', '<a href="/blog/">Directory</a>',
		'<a href="/about">Navigation</a>',
	])('skips a card without a usable first-party article link: %s', (body) => {
		expect(parseMetaAiResearch(wrap(card(body)))).toEqual([]);
	});

	it('ignores unmarked articles and links outside article cards', () => {
		expect(parseMetaAiResearch(wrap(`${link}<article>${link}</article>${card(link)}`)))
			.toEqual(parseMetaAiResearch(wrap(card(link))));
	});

	it('abandons truncated cards without borrowing the next card, and tolerates stray closes', () => {
		expect(parseMetaAiResearch(wrap(`</article><article data-blog-post-summary="card">${link}`)))
			.toEqual([]);
		expect(parseMetaAiResearch(wrap(`<article data-blog-post-summary="card">${card(link)}`)))
			.toEqual(parseMetaAiResearch(wrap(card(link))));
	});

	it('rejects error pages but accepts an empty listing', () => {
		for (const html of ['', '<html>Access denied</html>', '<article>Other site</article>']) {
			expect(() => parseMetaAiResearch(html)).toThrow(/^not a Meta AI research listing/);
		}
		expect(parseMetaAiResearch(wrap(''))).toEqual([]);
	});

	it('scans many unclosed cards without repeatedly searching to the end', () => {
		expect(parseMetaAiResearch(wrap('<article data-blog-post-summary="card">'.repeat(20_000))))
			.toEqual([]);
		expect(parseMetaAiResearch(wrap('<article '.repeat(20_000)))).toEqual([]);
		expect(parseMetaAiResearch(wrap(card(
			'<a href="/blog/example">' + '<h2>'.repeat(20_000),
		)))[0].title).toBe('');
	});
});
