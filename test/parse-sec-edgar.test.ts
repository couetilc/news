import { describe, expect, it } from 'vitest';
import { parseSecEdgar } from '../src/ingest/parse/sec-edgar';
import edgarJson from './fixtures/ti-sec-edgar.json?raw';

describe('parseSecEdgar — TI EDGAR submissions fixture', () => {
	const items = parseSecEdgar(edgarJson);

	it('keeps only 8-K / 8-K/A current reports, dropping 10-Q and Form 4', () => {
		// Fixture has 8-K, 8-K (multi-item), 10-Q, 8-K/A, Form 4 → 3 kept.
		expect(items).toHaveLength(3);
		expect(items.map((i) => i.guid)).toEqual([
			'0000950103-26-008325',
			'0000097476-26-000097',
			'0000097476-26-000040',
		]);
	});

	it('synthesizes a readable title from the 8-K item codes', () => {
		expect(items[0].title).toBe(
			'Texas Instruments 8-K — Departure or Appointment of Directors or Officers',
		);
		// Multiple item codes are joined.
		expect(items[1].title).toBe(
			'Texas Instruments 8-K — Results of Operations and Financial Condition; Financial Statements and Exhibits',
		);
	});

	it('keeps the item description as the summary and links out (no body HTML)', () => {
		expect(items[1].summary).toBe(
			'Results of Operations and Financial Condition; Financial Statements and Exhibits',
		);
		expect(items[1].contentHtml).toBeNull();
	});

	it('builds the primary-document URL from the accession number and filename', () => {
		expect(items[1].url).toBe(
			'https://www.sec.gov/Archives/edgar/data/97476/000009747626000097/txn-20260422.htm',
		);
	});

	it('preserves the 8-K/A amendment form in title and filtering', () => {
		const amendment = items[2];
		expect(amendment.title).toBe('Texas Instruments 8-K/A — Other Events');
	});

	it('parses acceptanceDateTime to unix seconds', () => {
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 2, 20, 16, 52) / 1000));
	});
});

describe('parseSecEdgar — edge cases', () => {
	// Build a minimal columnar `filings.recent` from a list of per-filing records.
	const wrap = (rows: Record<string, string>[]) => {
		const cols = [
			'accessionNumber',
			'filingDate',
			'acceptanceDateTime',
			'form',
			'items',
			'primaryDocument',
		];
		const recent: Record<string, string[]> = {};
		for (const c of cols) recent[c] = rows.map((r) => r[c] ?? '');
		return JSON.stringify({ filings: { recent } });
	};

	it('throws when filings.recent is missing', () => {
		expect(() => parseSecEdgar('{}')).toThrow(/not an EDGAR/);
	});

	it('throws when accessionNumber is not an array', () => {
		expect(() => parseSecEdgar(JSON.stringify({ filings: { recent: {} } }))).toThrow(
			/not an EDGAR/,
		);
	});

	it('skips an 8-K with no accession number (nothing to dedupe on)', () => {
		expect(
			parseSecEdgar(wrap([{ accessionNumber: '', form: '8-K', items: '8.01' }])),
		).toEqual([]);
	});

	it('falls back to the folder index URL when there is no primary document', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000001', form: '8-K', items: '8.01' }]),
		);
		expect(item.url).toBe(
			'https://www.sec.gov/Archives/edgar/data/97476/000009747626000001/',
		);
	});

	it('titles an 8-K with no items without the dash, and keeps summary null', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000002', form: '8-K', items: '' }]),
		);
		expect(item.title).toBe('Texas Instruments 8-K');
		expect(item.summary).toBeNull();
	});

	it('falls back to filingDate when acceptanceDateTime is absent', () => {
		const [item] = parseSecEdgar(
			wrap([
				{
					accessionNumber: '0000097476-26-000003',
					form: '8-K',
					items: '8.01',
					filingDate: '2026-02-10',
					acceptanceDateTime: '',
				},
			]),
		);
		expect(item.publishedAt).toBe(Math.floor(Date.parse('2026-02-10') / 1000));
	});

	it('labels an unmapped item code as "Item N.NN"', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000004', form: '8-K', items: '6.05' }]),
		);
		expect(item.title).toBe('Texas Instruments 8-K — Item 6.05');
	});

	it('ignores stray empty/whitespace item codes in the comma list', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000005', form: '8-K', items: '8.01, ,' }]),
		);
		expect(item.title).toBe('Texas Instruments 8-K — Other Events');
	});

	it('treats an items string with no real codes as no description (dashless title)', () => {
		// Non-empty (passes the `if (!items)` guard) but yields zero labels.
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000006', form: '8-K', items: ', ,' }]),
		);
		expect(item.title).toBe('Texas Instruments 8-K');
		expect(item.summary).toBeNull();
	});

	it('returns no items for an empty recent list', () => {
		expect(parseSecEdgar(wrap([]))).toEqual([]);
	});
});
