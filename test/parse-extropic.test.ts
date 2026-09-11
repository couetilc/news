import { describe, expect, it } from 'vitest';
import { countExtropic, parseExtropic } from '../src/ingest/parse/extropic';
import fixture from './fixtures/ai-labs/extropic.html?raw';

const script = (value: unknown) => `<script>self.__next_f.push(${JSON.stringify(value)})</script>`;
const flight = (object: unknown) => script([1, `31:${JSON.stringify(object)}\n`]);
const post = { _type: 'manualPost', title: 'New model', url: '/writing/model', publishDate: '2026-09-11' };

describe('Extropic Flight listing', () => {
	it('reads real listing props, research papers and referenced featured records without media noise', () => {
		const items = parseExtropic(fixture);
		expect(countExtropic(fixture)).toBe(12);
		expect(items).toHaveLength(12);
		expect(items[0]).toEqual({ title: 'Z1T: Transformer-like models for Z1', url: 'https://extropic.ai/writing/z1t', guid: 'https://extropic.ai/writing/z1t', publishedAt: 1788480000, summary: null, contentHtml: null });
		expect(items.map((i) => i.url)).toContain('https://arxiv.org/abs/2608.01615');
		expect(items.filter((i) => i.title === 'TSU 101')).toHaveLength(2); // D1 collapses featured/list copies.
		expect(items.some((i) => /wired|youtube/.test(i.url))).toBe(false);
	});
	it('ignores the global CMS inventory, reference strings, arbitrary JS and non-article metadata', () => {
		const html = '<script>throw new Error("never execute")</script>' + flight({ posts: [{ ...post, publishDate: null }] })
			+ flight({ totalCount: 5, posts: [null, '$31:props:featuredPosts:0', 1, { _type: 'mediaCoverage' }, post] });
		expect(parseExtropic(html).map((i) => i.title)).toEqual(['New model']);
		expect(countExtropic(html)).toBe(1);
	});
	it.each(['', '<script>self.__next_f.push(broken)</script>', script(null), script({}), script([1, null]), flight(null), flight([]), flight({ posts: [], totalCount: 0 }), flight({ featuredPosts: 'wrong' }), '<div>'.repeat(20000)])('rejects wrong, empty, or malformed transport', (html) => {
		expect(() => parseExtropic(html)).toThrow('not an AI lab listing');
		expect(countExtropic(html)).toBe(0);
	});
	it('handles semicolon calls, unrelated stream records, and slug-only posts', () => {
		const html = flight({ featuredPosts: [{ _type: 'post', title: 'TSU', slug: 'tsu', publishDate: '2026-08-01' }] }).replace(')</script>', ');</script>') + script([1, 'broken:{\n0:D{}\n']);
		expect(parseExtropic(html)[0].url).toBe('https://extropic.ai/writing/tsu');
	});
	it.each([
		{ ...post, title: null }, { ...post, title: ' ' }, { ...post, url: null },
		{ ...post, url: 1, slug: null }, { ...post, publishDate: null }, { ...post, publishDate: 'bad' },
		{ ...post, url: 'javascript:alert(1)' },
	])('fails visibly on an invalid article %j', (bad) => {
		const html = flight({ featuredPosts: [bad] });
		expect(countExtropic(html)).toBe(1);
		expect(() => parseExtropic(html)).toThrow('not an AI lab listing');
	});
});
