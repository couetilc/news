import { describe, expect, it } from 'vitest';
import { parseRss20 } from '../src/ingest/parse/rss20';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';
import ieeeXml from './fixtures/ieee-spectrum.xml?raw';

describe('parseRss20 — content:encoded mode (Cloudflare blog)', () => {
	const items = parseRss20(cloudflareXml, { content: 'content:encoded' });

	it('extracts every item in feed order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'Making Workers even faster',
			'Introducing D1 vector search',
		]);
	});

	it('takes content from content:encoded and summary from description', () => {
		expect(items[0].contentHtml).toBe(
			'<p>The full HTML body of the post, with <strong>markup</strong>.</p>',
		);
		expect(items[0].summary).toBe('A short summary of the post.');
	});

	it('normalizes guid, url, and published date', () => {
		expect(items[0].guid).toBe('https://blog.cloudflare.com/making-workers-faster/');
		expect(items[0].url).toBe('https://blog.cloudflare.com/making-workers-faster/');
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 12, 14, 0, 0) / 1000));
	});
});

describe('parseRss20 — description mode (IEEE Spectrum)', () => {
	const items = parseRss20(ieeeXml, { content: 'description' });

	it('takes full HTML from the CDATA description and leaves summary null', () => {
		expect(items[0].contentHtml).toBe(
			'<p>Full article HTML for the chip story, kilobytes in reality.</p>',
		);
		expect(items[0].summary).toBeNull();
	});

	it('preserves feed order including the stale 2022 tail item (sorting is the DB layer’s job)', () => {
		expect(items).toHaveLength(3);
		expect(items[2].publishedAt).toBe(Math.floor(Date.UTC(2022, 0, 3, 15, 0, 0) / 1000));
	});
});

describe('parseRss20 — edge cases', () => {
	const wrap = (inner: string) =>
		`<?xml version="1.0"?><rss version="2.0"><channel>${inner}</channel></rss>`;

	it('falls back to link when an item has no guid', () => {
		const [item] = parseRss20(
			wrap('<item><title>T</title><link>https://e.com/a</link></item>'),
			{ content: 'description' },
		);
		expect(item.guid).toBe('https://e.com/a');
		expect(item.url).toBe('https://e.com/a');
	});

	it('skips an item with neither guid nor link', () => {
		const items = parseRss20(wrap('<item><title>orphan</title></item>'), {
			content: 'description',
		});
		expect(items).toEqual([]);
	});

	it('defaults a missing title to an empty string', () => {
		const [item] = parseRss20(wrap('<item><guid>g1</guid></item>'), {
			content: 'description',
		});
		expect(item.title).toBe('');
	});

	it('keeps a numeric-looking guid as a string', () => {
		const [item] = parseRss20(wrap('<item><guid>123456</guid></item>'), {
			content: 'description',
		});
		expect(item.guid).toBe('123456');
	});

	it('yields an array for a single-item channel', () => {
		const items = parseRss20(wrap('<item><guid>only</guid></item>'), {
			content: 'description',
		});
		expect(Array.isArray(items)).toBe(true);
		expect(items).toHaveLength(1);
	});

	it('returns no items for a channel that has metadata but no entries', () => {
		expect(parseRss20(wrap('<title>Empty feed</title>'), { content: 'description' })).toEqual(
			[],
		);
	});

	it('leaves contentHtml null when content:encoded is absent', () => {
		const [item] = parseRss20(wrap('<item><guid>g</guid></item>'), {
			content: 'content:encoded',
		});
		expect(item.contentHtml).toBeNull();
	});

	it('throws on a payload that is not an RSS 2.0 feed', () => {
		expect(() => parseRss20('<feed><entry/></feed>', { content: 'description' })).toThrow(
			/not an RSS 2.0 feed/,
		);
	});
});
