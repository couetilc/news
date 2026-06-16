import { describe, expect, it } from 'vitest';
import { parseAtom } from '../src/ingest/parse/atom';
import appleXml from './fixtures/apple.xml?raw';

describe('parseAtom — summary-only mode (Apple Newsroom)', () => {
	const items = parseAtom(appleXml, { content: 'summary-only' });

	it('extracts every entry in feed order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'Apple unveils innovative features across services',
			'Apple reports second quarter results',
		]);
	});

	it('keeps the <content> teaser as the summary and leaves contentHtml null', () => {
		expect(items[0].summary).toBe(
			'With the 2027 software releases coming this fall, Apple is bringing powerful new features to services users.',
		);
		expect(items[0].contentHtml).toBeNull();
	});

	it('uses the alternate <link> for the url, ignoring the rel="enclosure" image', () => {
		expect(items[0].url).toBe(
			'https://www.apple.com/newsroom/2026/06/apple-unveils-innovative-features-across-services/',
		);
		expect(items[0].url).not.toContain('.jpg');
	});

	it('normalizes guid from <id> and the date from <updated> (no <published>)', () => {
		expect(items[0].guid).toBe(
			'https://www.apple.com/newsroom/2026/06/apple-unveils-innovative-features-across-services/',
		);
		expect(items[0].publishedAt).toBe(
			Math.floor(Date.UTC(2026, 5, 9, 13, 0, 15, 876) / 1000),
		);
	});

	it('preserves both PRESS RELEASE and UPDATE entries (no type filtering)', () => {
		expect(items).toHaveLength(2);
		expect(items[1].guid).toContain('apple-reports-second-quarter-results');
	});
});

describe('parseAtom — content and summary modes', () => {
	const wrap = (inner: string) =>
		`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${inner}</feed>`;

	it('content mode: full HTML from <content>, short summary from <summary>', () => {
		const [item] = parseAtom(
			wrap(
				'<entry><id>g1</id><content type="html">&lt;p&gt;body&lt;/p&gt;</content><summary>short</summary></entry>',
			),
			{ content: 'content' },
		);
		expect(item.contentHtml).toBe('<p>body</p>');
		expect(item.summary).toBe('short');
	});

	it('summary mode: full HTML from <summary>, no separate summary', () => {
		const [item] = parseAtom(
			wrap('<entry><id>g1</id><summary type="html">&lt;p&gt;body&lt;/p&gt;</summary></entry>'),
			{ content: 'summary' },
		);
		expect(item.contentHtml).toBe('<p>body</p>');
		expect(item.summary).toBeNull();
	});
});

describe('parseAtom — edge cases', () => {
	const wrap = (inner: string) =>
		`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${inner}</feed>`;

	it('falls back to the alternate link when an entry has no <id>', () => {
		const [item] = parseAtom(
			wrap('<entry><title>T</title><link href="https://a.com/x"/></entry>'),
			{ content: 'summary-only' },
		);
		expect(item.guid).toBe('https://a.com/x');
		expect(item.url).toBe('https://a.com/x');
	});

	it('falls back url to guid when no usable link is present', () => {
		const [item] = parseAtom(wrap('<entry><id>only-id</id></entry>'), {
			content: 'summary-only',
		});
		expect(item.url).toBe('only-id');
	});

	it('treats rel="alternate" as the article link', () => {
		const [item] = parseAtom(
			wrap('<entry><id>g</id><link href="https://a.com/alt" rel="alternate"/></entry>'),
			{ content: 'summary-only' },
		);
		expect(item.url).toBe('https://a.com/alt');
	});

	it('skips a link element that has a rel="self" but no usable alternate', () => {
		const [item] = parseAtom(
			wrap('<entry><id>g</id><link href="https://a.com/self" rel="self"/></entry>'),
			{ content: 'summary-only' },
		);
		// No alternate link, so url falls back to the id.
		expect(item.url).toBe('g');
	});

	it('ignores a link with no href attribute', () => {
		const [item] = parseAtom(wrap('<entry><id>g</id><link rel="alternate"/></entry>'), {
			content: 'summary-only',
		});
		expect(item.url).toBe('g');
	});

	it('skips an entry with neither <id> nor a usable link', () => {
		const items = parseAtom(wrap('<entry><title>orphan</title></entry>'), {
			content: 'summary-only',
		});
		expect(items).toEqual([]);
	});

	it('defaults a missing title to an empty string', () => {
		const [item] = parseAtom(wrap('<entry><id>g1</id></entry>'), {
			content: 'summary-only',
		});
		expect(item.title).toBe('');
	});

	it('leaves summary null when <content> is absent in summary-only mode', () => {
		const [item] = parseAtom(wrap('<entry><id>g1</id></entry>'), {
			content: 'summary-only',
		});
		expect(item.summary).toBeNull();
		expect(item.contentHtml).toBeNull();
	});

	it('treats an empty <content> element as null', () => {
		const [item] = parseAtom(wrap('<entry><id>g1</id><content></content></entry>'), {
			content: 'summary-only',
		});
		expect(item.summary).toBeNull();
	});

	it('reads element text even when the element carries attributes', () => {
		const [item] = parseAtom(
			wrap('<entry><id>g1</id><content type="text">teaser</content></entry>'),
			{ content: 'summary-only' },
		);
		expect(item.summary).toBe('teaser');
	});

	it('treats an attribute-only element with no text as null', () => {
		const [item] = parseAtom(
			wrap('<entry><id>g1</id><content type="html"/></entry>'),
			{ content: 'summary-only' },
		);
		expect(item.summary).toBeNull();
	});

	it('leaves publishedAt null when neither <published> nor <updated> is present', () => {
		const [item] = parseAtom(wrap('<entry><id>g1</id></entry>'), {
			content: 'summary-only',
		});
		expect(item.publishedAt).toBeNull();
	});

	it('prefers <published> over <updated> when both are present', () => {
		const [item] = parseAtom(
			wrap(
				'<entry><id>g1</id><published>2026-01-02T00:00:00Z</published><updated>2026-06-09T00:00:00Z</updated></entry>',
			),
			{ content: 'summary-only' },
		);
		expect(item.publishedAt).toBe(Math.floor(Date.UTC(2026, 0, 2, 0, 0, 0) / 1000));
	});

	it('yields an array for a single-entry feed', () => {
		const items = parseAtom(wrap('<entry><id>only</id></entry>'), {
			content: 'summary-only',
		});
		expect(Array.isArray(items)).toBe(true);
		expect(items).toHaveLength(1);
	});

	it('returns no items for a feed that has metadata but no entries', () => {
		expect(parseAtom(wrap('<title>Empty feed</title>'), { content: 'summary-only' })).toEqual(
			[],
		);
	});

	it('throws on a payload that is not an Atom feed', () => {
		expect(() => parseAtom('<rss><channel/></rss>', { content: 'summary-only' })).toThrow(
			/not an Atom feed/,
		);
	});

	// #165 (fuzz-found): malformed tag nesting made fast-xml-parser throw a raw
	// "Cannot read properties of undefined (reading 'addChild')" TypeError instead
	// of the documented rejection. Each malformed/truncated payload must surface as
	// "not an Atom feed", never an undocumented runtime error.
	it('rejects malformed tag nesting with the documented error (no TypeError)', () => {
		expect(() => parseAtom('</item><item>', { content: 'content' })).toThrow(/not an Atom feed/);
		expect(() => parseAtom('</item><item>', { content: 'content' })).not.toThrow(TypeError);
	});

	it('rejects a truncated CDATA payload with the documented error (no raw parser error)', () => {
		expect(() => parseAtom('<![CDATA[', { content: 'summary-only' })).toThrow(
			/not an Atom feed: malformed XML/,
		);
		expect(() => parseAtom('<![CDATA[', { content: 'summary-only' })).not.toThrow(/CDATA/);
	});

	it('rejects an empty payload with the documented error', () => {
		expect(() => parseAtom('', { content: 'summary-only' })).toThrow(/not an Atom feed/);
	});
});
