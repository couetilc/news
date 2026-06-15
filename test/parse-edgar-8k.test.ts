import { describe, expect, it } from 'vitest';
import { parseEdgar8k } from '../src/ingest/parse/edgar-8k';
import ciscoEdgarXml from './fixtures/cisco-edgar-8k.xml?raw';

describe('parseEdgar8k — Cisco 8-K Atom fixture (#31)', () => {
	const items = parseEdgar8k(ciscoEdgarXml);

	it('keeps only the Item 2.02 earnings 8-Ks, dropping other 8-Ks (e.g. Item 5.02)', () => {
		// The fixture has three 8-Ks: two Item-2.02 earnings filings and one
		// Item-5.02 (director change). Only the earnings ones survive the filter.
		expect(items.map((i) => i.guid)).toEqual([
			'0000858877-26-000075',
			'0000858877-26-000006',
		]);
	});

	it('uses the accession number as the stable dedupe guid', () => {
		expect(items[0].guid).toBe('0000858877-26-000075');
	});

	it('synthesizes a human title from the filing type and date (not the generic feed title)', () => {
		expect(items[0].title).toBe(
			'Cisco 8-K: Results of Operations and Financial Condition (Item 2.02) — filed 2026-05-13',
		);
	});

	it('links out to the filing index page', () => {
		expect(items[0].url).toBe(
			'https://www.sec.gov/Archives/edgar/data/858877/000085887726000075/0000858877-26-000075-index.htm',
		);
	});

	it('keeps the EDGAR summary blurb as the summary and leaves contentHtml null', () => {
		expect(items[0].summary).toContain('Item 2.02: Results of Operations');
		expect(items[0].contentHtml).toBeNull();
	});

	it('parses the precise <updated> timestamp (with its offset) to unix seconds', () => {
		// 2026-05-13T16:06:53-04:00 == 2026-05-13T20:06:53Z.
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 4, 13, 20, 6, 53) / 1000));
	});

	it('matches Item 2.02 despite inconsistent EDGAR items-desc spacing', () => {
		// First entry's items-desc is "items 2.02, 2.05and9.01"; the third is
		// "items 2.02 and 9.01" — both must match.
		expect(items[1].guid).toBe('0000858877-26-000006');
		expect(items[1].title).toContain('filed 2026-02-11');
	});
});

describe('parseEdgar8k — edge cases', () => {
	const wrap = (inner: string) =>
		`<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${inner}</feed>`;
	const entry = (content: string, rest = '') =>
		wrap(`<entry><content type="text/xml">${content}</content>${rest}</entry>`);

	it('throws on a payload that is not an EDGAR Atom feed', () => {
		expect(() => parseEdgar8k('<rss><channel/></rss>')).toThrow(/not an EDGAR Atom feed/);
	});

	it('returns no items for a feed with no entries', () => {
		expect(parseEdgar8k(wrap('<company-info><cik>0000858877</cik></company-info>'))).toEqual([]);
	});

	it('skips an entry whose items-desc lacks Item 2.02', () => {
		expect(
			parseEdgar8k(
				entry('<accession-number>acc-1</accession-number><items-desc>item 5.02</items-desc>'),
			),
		).toEqual([]);
	});

	it('skips an entry with no items-desc at all', () => {
		expect(parseEdgar8k(entry('<accession-number>acc-1</accession-number>'))).toEqual([]);
	});

	it('does not match a longer item number that merely contains 2.02', () => {
		expect(
			parseEdgar8k(
				entry('<accession-number>acc-1</accession-number><items-desc>item 12.02</items-desc>'),
			),
		).toEqual([]);
	});

	it('skips an Item 2.02 entry that has no accession number to dedupe on', () => {
		expect(parseEdgar8k(entry('<items-desc>item 2.02</items-desc>'))).toEqual([]);
	});

	it('falls back to a date-free title and the filing-href url when fields are sparse', () => {
		const [item] = parseEdgar8k(
			entry(
				'<accession-number>acc-2</accession-number>' +
					'<items-desc>item 2.02</items-desc>' +
					'<filing-href>https://sec.gov/acc-2.htm</filing-href>',
			),
		);
		// No filing-date and no filing-type → generic title; no <link> → filing-href.
		expect(item.title).toBe(
			'Cisco 8-K: Results of Operations and Financial Condition (Item 2.02)',
		);
		expect(item.url).toBe('https://sec.gov/acc-2.htm');
		expect(item.summary).toBeNull();
		expect(item.publishedAt).toBeNull();
	});

	it('falls back to <filing-date> for the timestamp when <updated> is absent', () => {
		const [item] = parseEdgar8k(
			entry(
				'<accession-number>acc-3</accession-number>' +
					'<items-desc>item 2.02</items-desc>' +
					'<filing-date>2026-05-13</filing-date>',
			),
		);
		expect(item.publishedAt).toBe(Math.floor(Date.UTC(2026, 4, 13) / 1000));
	});

	it('falls back to the accession number for url when no link or filing-href exists', () => {
		const [item] = parseEdgar8k(
			entry('<accession-number>acc-4</accession-number><items-desc>item 2.02</items-desc>'),
		);
		expect(item.url).toBe('acc-4');
	});

	it('reads the href from a single <link> object (not just an array)', () => {
		const [item] = parseEdgar8k(
			entry(
				'<accession-number>acc-5</accession-number><items-desc>item 2.02</items-desc>',
				'<link href="https://sec.gov/acc-5.htm" rel="alternate" />',
			),
		);
		expect(item.url).toBe('https://sec.gov/acc-5.htm');
	});

	it('ignores a <link> with no usable href and falls through to the accession url', () => {
		const [item] = parseEdgar8k(
			entry(
				'<accession-number>acc-6</accession-number><items-desc>item 2.02</items-desc>',
				'<link rel="self" />',
			),
		);
		expect(item.url).toBe('acc-6');
	});

	it('iterates a single-entry feed (entry forced to an array)', () => {
		const items = parseEdgar8k(
			entry('<accession-number>acc-7</accession-number><items-desc>item 2.02</items-desc>'),
		);
		expect(Array.isArray(items)).toBe(true);
		expect(items).toHaveLength(1);
	});

	it('takes the first usable href when an entry carries multiple <link>s', () => {
		// Two <link>s parse to an array; the first with an href wins.
		const [item] = parseEdgar8k(
			entry(
				'<accession-number>acc-8</accession-number><items-desc>item 2.02</items-desc>',
				'<link rel="self" /><link href="https://sec.gov/acc-8.htm" rel="alternate" />',
			),
		);
		expect(item.url).toBe('https://sec.gov/acc-8.htm');
	});

	it('skips an entry with no <content> block (no items-desc to qualify it)', () => {
		expect(parseEdgar8k(wrap('<entry><title>8-K</title></entry>'))).toEqual([]);
	});
});
