import { describe, expect, it } from 'vitest';
import { parseSecEdgar } from '../src/ingest/parse/sec-edgar';
import ciscoJson from './fixtures/cisco-sec-edgar.json?raw';
import edgarJson from './fixtures/ti-sec-edgar.json?raw';

// TI's registry call site: all 8-Ks, no item filter.
const TI = { cik: '97476', issuer: 'Texas Instruments' } as const;
// Cisco's backstop call site: 8-Ks narrowed to Item 2.02 earnings only.
const CISCO = { cik: '858877', issuer: 'Cisco', items: ['2.02'] } as const;

describe('parseSecEdgar — TI EDGAR submissions fixture (all 8-Ks)', () => {
	const items = parseSecEdgar(edgarJson, TI);

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

	it('builds the primary-document URL from the CIK, accession number, and filename', () => {
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

describe('parseSecEdgar — Cisco backstop fixture (Item 2.02 earnings only)', () => {
	const items = parseSecEdgar(ciscoJson, CISCO);

	it('keeps only the Item 2.02 earnings 8-Ks, dropping the 10-Q and Item 5.02 8-K', () => {
		// Fixture: 10-Q, 8-K (2.02,2.05,9.01), 8-K (5.02), 8-K (2.02,9.01) → 2 kept.
		expect(items.map((i) => i.guid)).toEqual([
			'0000858877-26-000075',
			'0000858877-26-000006',
		]);
	});

	it('uses the accession number as the stable dedupe guid', () => {
		expect(items[0].guid).toBe('0000858877-26-000075');
	});

	it('synthesizes a Cisco-prefixed title from all the filing item codes', () => {
		expect(items[0].title).toBe(
			'Cisco 8-K — Results of Operations and Financial Condition; Costs Associated with Exit or Disposal Activities; Financial Statements and Exhibits',
		);
	});

	it('builds the document URL under the Cisco CIK', () => {
		expect(items[0].url).toBe(
			'https://www.sec.gov/Archives/edgar/data/858877/000085887726000075/csco-20260513.htm',
		);
	});

	it('keeps the item description as summary and leaves contentHtml null', () => {
		expect(items[0].summary).toContain('Results of Operations and Financial Condition');
		expect(items[0].contentHtml).toBeNull();
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
		expect(() => parseSecEdgar('{}', TI)).toThrow(/not an EDGAR/);
	});

	it('throws when accessionNumber is not an array', () => {
		expect(() => parseSecEdgar(JSON.stringify({ filings: { recent: {} } }), TI)).toThrow(
			/not an EDGAR/,
		);
	});

	it('skips an 8-K with no accession number (nothing to dedupe on)', () => {
		expect(
			parseSecEdgar(wrap([{ accessionNumber: '', form: '8-K', items: '8.01' }]), TI),
		).toEqual([]);
	});

	it('drops a filing whose form is not in the kept set', () => {
		// A 10-K periodic report is not in the default 8-K family.
		expect(
			parseSecEdgar(
				wrap([{ accessionNumber: '0000097476-26-000099', form: '10-K', items: '' }]),
				TI,
			),
		).toEqual([]);
	});

	it('skips a row with no form at all', () => {
		expect(
			parseSecEdgar(
				wrap([{ accessionNumber: '0000097476-26-000098', form: '', items: '8.01' }]),
				TI,
			),
		).toEqual([]);
	});

	it('falls back to the folder index URL when there is no primary document', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000001', form: '8-K', items: '8.01' }]),
			TI,
		);
		expect(item.url).toBe(
			'https://www.sec.gov/Archives/edgar/data/97476/000009747626000001/',
		);
	});

	it('titles an 8-K with no items without the dash, and keeps summary null', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000002', form: '8-K', items: '' }]),
			TI,
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
			TI,
		);
		expect(item.publishedAt).toBe(Math.floor(Date.parse('2026-02-10') / 1000));
	});

	it('labels an unmapped item code as "Item N.NN"', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000004', form: '8-K', items: '6.05' }]),
			TI,
		);
		expect(item.title).toBe('Texas Instruments 8-K — Item 6.05');
	});

	it('ignores stray empty/whitespace item codes in the comma list', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000005', form: '8-K', items: '8.01, ,' }]),
			TI,
		);
		expect(item.title).toBe('Texas Instruments 8-K — Other Events');
	});

	it('treats an items string with no real codes as no description (dashless title)', () => {
		// Non-empty (passes the `if (!items)` guard) but yields zero labels.
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000006', form: '8-K', items: ', ,' }]),
			TI,
		);
		expect(item.title).toBe('Texas Instruments 8-K');
		expect(item.summary).toBeNull();
	});

	it('returns no items for an empty recent list', () => {
		expect(parseSecEdgar(wrap([]), TI)).toEqual([]);
	});

	it('drops an 8-K lacking the requested item code when an item filter is set', () => {
		// Item 5.02 only — not 2.02 — so the Cisco-style filter rejects it.
		expect(
			parseSecEdgar(
				wrap([{ accessionNumber: '0000858877-26-000057', form: '8-K', items: '5.02' }]),
				CISCO,
			),
		).toEqual([]);
	});

	it('drops an items-less 8-K when an item filter is set', () => {
		// No item codes can satisfy the filter, so the filing is rejected.
		expect(
			parseSecEdgar(
				wrap([{ accessionNumber: '0000858877-26-000058', form: '8-K', items: '' }]),
				CISCO,
			),
		).toEqual([]);
	});

	it('keeps an 8-K reporting the requested item among several codes', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000858877-26-000059', form: '8-K', items: '2.02,9.01' }]),
			CISCO,
		);
		expect(item.guid).toBe('0000858877-26-000059');
	});

	it('honors a custom forms override (e.g. periodic 10-Q reports)', () => {
		const [item] = parseSecEdgar(
			wrap([{ accessionNumber: '0000097476-26-000100', form: '10-Q', items: '' }]),
			{ cik: '97476', issuer: 'Texas Instruments', forms: ['10-Q'] },
		);
		expect(item.title).toBe('Texas Instruments 10-Q');
	});

	// #79 — synthesize a long, most-recent-first run of matching 8-Ks (more than
	// any sensible cap) to prove the parser never backfills the whole history.
	const manyEightKs = (count: number) =>
		Array.from({ length: count }, (_, i) => ({
			// Accession suffixes count DOWN so index 0 is the newest filing, matching
			// EDGAR's most-recent-first ordering of filings.recent.
			accessionNumber: `0000097476-26-${String(count - i).padStart(6, '0')}`,
			form: '8-K',
			items: '8.01',
		}));

	it('does NOT ingest the full filings.recent history — caps to the default window', () => {
		// 95 matching 8-Ks (the live-TI backfill the issue cites) must collapse to
		// the 20-row default window, keeping the 20 MOST-RECENT ones (indices 0–19).
		const all = manyEightKs(95);
		const items = parseSecEdgar(wrap(all), TI);
		expect(items).toHaveLength(20);
		expect(items.map((i) => i.guid)).toEqual(all.slice(0, 20).map((r) => r.accessionNumber));
		// The oldest filings (e.g. the 2017-era tail) are dropped, not ingested.
		expect(items.map((i) => i.guid)).not.toContain('0000097476-26-000001');
	});

	it('caps to an explicit, smaller limit and keeps the most-recent matches', () => {
		const all = manyEightKs(10);
		const items = parseSecEdgar(wrap(all), { ...TI, limit: 3 });
		expect(items.map((i) => i.guid)).toEqual([
			'0000097476-26-000010',
			'0000097476-26-000009',
			'0000097476-26-000008',
		]);
	});

	it('counts only kept (matching) filings toward the limit, scanning past drops', () => {
		// Interleave non-matching 10-Q rows between 8-Ks: the cap counts kept items,
		// so it must scan past the 10-Qs to gather `limit` real 8-Ks.
		const rows = [
			{ accessionNumber: '0000097476-26-000020', form: '8-K', items: '8.01' },
			{ accessionNumber: '0000097476-26-000019', form: '10-Q', items: '' },
			{ accessionNumber: '0000097476-26-000018', form: '8-K', items: '8.01' },
			{ accessionNumber: '0000097476-26-000017', form: '10-Q', items: '' },
			{ accessionNumber: '0000097476-26-000016', form: '8-K', items: '8.01' },
		];
		const items = parseSecEdgar(wrap(rows), { ...TI, limit: 2 });
		expect(items.map((i) => i.guid)).toEqual([
			'0000097476-26-000020',
			'0000097476-26-000018',
		]);
	});

	it('keeps nothing when the limit is 0 (early-exits before the first keep)', () => {
		const all = manyEightKs(5);
		expect(parseSecEdgar(wrap(all), { ...TI, limit: 0 })).toEqual([]);
	});
});
