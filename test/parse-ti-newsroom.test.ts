import { describe, expect, it } from 'vitest';
import { parseTiNewsroom } from '../src/ingest/parse/ti-newsroom';
import newsJson from './fixtures/ti-news-releases.json?raw';
import blogJson from './fixtures/ti-company-blog.json?raw';

describe('parseTiNewsroom — TI News Releases fixture', () => {
	const items = parseTiNewsroom(newsJson);

	it('drops the leading count element and parses the records', () => {
		// Fixture: ["1451", rec, rec, rec] → 3 items.
		expect(items).toHaveLength(3);
	});

	it('uses headline as the title and the article path as guid and url', () => {
		expect(items[0].title).toBe(
			"TI brings intelligence to battery management systems with industry's highest-cell-count EIS-enabled battery monitor",
		);
		expect(items[0].guid).toBe(
			'https://www.ti.com/about-ti/newsroom/news-releases/2026/2026-06-09-ti-brings-intelligence-to-battery-management-systems-with-industry-s-highest-cell-count-eis-enabled-battery-monitor.html',
		);
		expect(items[0].url).toBe(items[0].guid);
	});

	it('keeps subheadline as the summary and links out (no body HTML)', () => {
		expect(items[1].summary).toBe(
			'Julie Knecht named senior vice president and chief financial officer; Rafael Lizardi to retire in August 2026',
		);
		expect(items[1].contentHtml).toBeNull();
	});

	it('parses the "DD Mon YYYY" date to unix seconds (UTC)', () => {
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 9) / 1000));
	});

	it('treats an empty subheadline as no summary', () => {
		// Third record has subheadline: "".
		expect(items[2].summary).toBeNull();
	});
});

describe('parseTiNewsroom — TI Company Blog fixture', () => {
	const items = parseTiNewsroom(blogJson);

	it('parses the blog records (same shape as news)', () => {
		expect(items).toHaveLength(2);
		expect(items[0].title).toBe('Reliability will define the next decade of energy storage');
	});

	it('falls back to name when headline is empty, decoding HTML entities', () => {
		// Second record has headline:"" and name with a &apos; entity.
		expect(items[1].title).toBe(
			"Uncovering the legacy of DSP technology: How a children's toy sparked the edge AI revolution",
		);
	});

	it('decodes named (&amp;) and numeric (&#8217;) entities in the summary', () => {
		expect(items[1].summary).toBe(
			'Listen to the story of how TI cemented its legacy in signal processing with the Speak & Spell* and continues the innovation with today’s edge AI-enabled devices.',
		);
	});
});

describe('parseTiNewsroom — edge cases', () => {
	it('throws when the response is not an array', () => {
		expect(() => parseTiNewsroom('{}')).toThrow(/not a TI newsroom/);
	});

	it('returns no items for a count-only response', () => {
		expect(parseTiNewsroom('["0"]')).toEqual([]);
	});

	it('skips a record with no path (nothing to dedupe on)', () => {
		const json = JSON.stringify(['1', { headline: 'No link', path: '' }]);
		expect(parseTiNewsroom(json)).toEqual([]);
	});

	it('yields an empty title when neither headline nor name is present', () => {
		const json = JSON.stringify(['1', { path: 'https://www.ti.com/x.html' }]);
		const [item] = parseTiNewsroom(json);
		expect(item.title).toBe('');
		expect(item.summary).toBeNull();
		expect(item.publishedAt).toBeNull();
	});

	it('decodes hex numeric entities and leaves unknown named entities untouched', () => {
		// &#x2019; (hex right single quote) decodes; &bogus; is unknown → kept.
		const json = JSON.stringify([
			'1',
			{
				path: 'https://www.ti.com/y.html',
				headline: 'Caf&#xe9; &bogus; note',
			},
		]);
		const [item] = parseTiNewsroom(json);
		expect(item.title).toBe('Café &bogus; note');
	});

	it('leaves a malformed numeric entity untouched', () => {
		// &#; has no digits, so it doesn't match the entity regex → passed through.
		const json = JSON.stringify([
			'1',
			{ path: 'https://www.ti.com/z.html', headline: 'A &#; B' },
		]);
		const [item] = parseTiNewsroom(json);
		expect(item.title).toBe('A &#; B');
	});

	it('treats a whitespace-only field as null after decoding', () => {
		const json = JSON.stringify([
			'1',
			{ path: 'https://www.ti.com/w.html', headline: '  ', subheadline: '   ' },
		]);
		const [item] = parseTiNewsroom(json);
		// headline is whitespace → null → falls back to name (absent) → '' title.
		expect(item.title).toBe('');
		// subheadline "&nbsp;" + spaces decodes to whitespace → null.
		expect(item.summary).toBeNull();
	});
});
