import { describe, expect, it } from 'vitest';
import { parseOwenomics } from '../src/ingest/parse/owenomics';
import owenomicsJson from './fixtures/owenomics.json?raw';

// #333 — Acadian Asset Management "Owenomics" (Owen Lamont). The listing page is
// a server-rendered Sitecore shell whose article cards load client-side from the
// ResultsListingApi endpoint; we poll that endpoint. The fixture is the REAL
// live response (2026-08-30), Results trimmed from 20 to the 5 newest records
// (the envelope — CurrentPage/Filters/ResultsLabel/TotalPages — kept verbatim).
// parseOwenomics reads `Results`, resolves the site-relative article Url to an
// absolute acadian-asset.com URL (the guid), strips the /au/ locale prefix and
// dedupes, excludes the /subscribe email-form link, links out (no teaser/body →
// summary and contentHtml null), and normalizes the month-granularity `Date`
// ("August 2026") to first-of-month UTC unix seconds.

describe('parseOwenomics — real ResultsListingApi shape (fixture)', () => {
	const items = parseOwenomics(owenomicsJson);

	it('extracts every listing record in feed order (newest first)', () => {
		expect(items.map((i) => i.title)).toEqual([
			'Crazy days in the stock market',
			'The frenzied serenity of the stock market',
			'Hynix Hijinks',
			'America’s first bubble',
			'Waiter, there’s a P in my E',
		]);
	});

	it('resolves the site-relative Url to an absolute acadian-asset.com URL, used as guid', () => {
		expect(items[0].url).toBe(
			'https://www.acadian-asset.com/investment-insights/owenomics/crazy-days-in-the-stock-market',
		);
		// guid === url: the article page is the stable dedupe key.
		expect(items[0].guid).toBe(items[0].url);
	});

	it('links out: the listing has no teaser or body, so summary and contentHtml are null', () => {
		for (const item of items) {
			expect(item.summary).toBeNull();
			expect(item.contentHtml).toBeNull();
		}
	});

	it('normalizes the month-granularity Date to first-of-month 00:00 UTC', () => {
		// "August 2026" → 2026-08-01T00:00:00Z. Month precision is all the listing
		// (and the article pages' visible dateline) carries — see the parser header.
		expect(items[0].publishedAt).toBe(1785542400);
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 1) / 1000));
		// "June 2026" → 2026-06-01T00:00:00Z; two June essays tie by design.
		expect(items[3].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 1) / 1000));
		expect(items[4].publishedAt).toBe(items[3].publishedAt);
	});

	it('yields the full ParsedItem shape for a record', () => {
		expect(items[1]).toEqual({
			guid: 'https://www.acadian-asset.com/investment-insights/owenomics/the-frenzied-serenity-of-the-stock-market',
			url: 'https://www.acadian-asset.com/investment-insights/owenomics/the-frenzied-serenity-of-the-stock-market',
			title: 'The frenzied serenity of the stock market',
			summary: null,
			contentHtml: null,
			publishedAt: Math.floor(Date.UTC(2026, 6, 1) / 1000),
		});
	});
});

describe('parseOwenomics — edge cases and the parser-robustness contract (#165)', () => {
	const wrap = (Results: unknown) => JSON.stringify({ Results });

	it('excludes the /subscribe email-form link from the items', () => {
		// The subscribe page sits under the same path family
		// (/investment-insights/owenomics/subscribe) but is a form, not an article.
		const items = parseOwenomics(
			wrap([
				{ Title: 'Subscribe', Url: '/investment-insights/owenomics/subscribe' },
				{ Title: 'Kept', Url: '/investment-insights/owenomics/kept' },
			]),
		);
		expect(items.map((i) => i.title)).toEqual(['Kept']);
	});

	it('normalizes an /au/ locale path onto the non-regional URL', () => {
		// The AU site variant (site=acadianAU) serves the same articles under
		// /au/investment-insights/owenomics/<slug> — real path shape from the #333
		// live probe.
		const [item] = parseOwenomics(
			wrap([{ Title: 'Hynix Hijinks', Url: '/au/investment-insights/owenomics/hynix-hijinks' }]),
		);
		expect(item.url).toBe(
			'https://www.acadian-asset.com/investment-insights/owenomics/hynix-hijinks',
		);
		expect(item.guid).toBe(item.url);
	});

	it('dedupes a locale duplicate against its non-regional record (first kept)', () => {
		const items = parseOwenomics(
			wrap([
				{ Title: 'Canonical', Url: '/investment-insights/owenomics/hynix-hijinks' },
				{ Title: 'AU duplicate', Url: '/au/investment-insights/owenomics/hynix-hijinks' },
			]),
		);
		expect(items).toHaveLength(1);
		expect(items[0].title).toBe('Canonical');
	});

	it('passes an already-absolute url through unchanged (no double origin prefix)', () => {
		const [item] = parseOwenomics(
			wrap([{ Title: 'Abs', Url: 'https://www.acadian-asset.com/investment-insights/owenomics/abs' }]),
		);
		expect(item.url).toBe('https://www.acadian-asset.com/investment-insights/owenomics/abs');
		expect(item.url).not.toContain('.comhttps');
		// A plain-http absolute URL is also passed through, never origin-prefixed.
		const [http] = parseOwenomics(
			wrap([{ Title: 'Http', Url: 'http://www.acadian-asset.com/investment-insights/owenomics/old' }]),
		);
		expect(http.url).toBe('http://www.acadian-asset.com/investment-insights/owenomics/old');
	});

	it('treats a relative path as relative even when a URL is embedded mid-path', () => {
		// "absolute" means the scheme at position 0 — an https:// deeper in the
		// path must not suppress the origin prefix.
		const [item] = parseOwenomics(
			wrap([{ Title: 'Embed', Url: '/investment-insights/owenomics/notes-on-https://bubbles' }]),
		);
		expect(item.url).toBe(
			'https://www.acadian-asset.com/investment-insights/owenomics/notes-on-https://bubbles',
		);
	});

	it('skips a record with no Url (nothing stable to dedupe on)', () => {
		expect(parseOwenomics(wrap([{ Title: 'No link', Date: 'August 2026' }]))).toEqual([]);
		expect(parseOwenomics(wrap([{ Title: 'Empty link', Url: '' }]))).toEqual([]);
	});

	it('skips a null/non-object array element without crashing', () => {
		const items = parseOwenomics(wrap([null, 7, 'x', { Url: '/keep', Title: 'Kept' }]));
		expect(items.map((i) => i.title)).toEqual(['Kept']);
		expect(items[0].url).toBe('https://www.acadian-asset.com/keep');
	});

	it('defaults a missing title to an empty string', () => {
		const [item] = parseOwenomics(wrap([{ Url: '/a' }]));
		expect(item.title).toBe('');
	});

	it('decodes HTML entities in the title and treats an entity-only title as empty (#224)', () => {
		const items = parseOwenomics(
			wrap([
				{ Url: '/a', Title: 'Bulls &amp; bears&#39; market' },
				{ Url: '/b', Title: '&nbsp; ' },
			]),
		);
		expect(items[0].title).toBe("Bulls & bears' market");
		expect(items[1].title).toBe('');
	});

	it('leaves publishedAt null when Date is missing, junk, or not "Month YYYY"', () => {
		expect(parseOwenomics(wrap([{ Url: '/a' }]))[0].publishedAt).toBeNull();
		// Not the "Month YYYY" shape at all.
		expect(parseOwenomics(wrap([{ Url: '/b', Date: '3 weeks ago' }]))[0].publishedAt).toBeNull();
		expect(parseOwenomics(wrap([{ Url: '/c', Date: '2026-08-19' }]))[0].publishedAt).toBeNull();
		// Right shape, unrecognized month name.
		expect(parseOwenomics(wrap([{ Url: '/d', Date: 'Smarch 2026' }]))[0].publishedAt).toBeNull();
		// Non-string junk in the Date slot.
		expect(parseOwenomics(wrap([{ Url: '/e', Date: 1785542400 }]))[0].publishedAt).toBeNull();
		// "Month YYYY" must be the WHOLE string — leading or trailing extra text is
		// junk, not a match (the regex is anchored on both ends).
		expect(
			parseOwenomics(wrap([{ Url: '/f', Date: 'circa August 2026' }]))[0].publishedAt,
		).toBeNull();
		expect(
			parseOwenomics(wrap([{ Url: '/g', Date: 'August 2026 (revised)' }]))[0].publishedAt,
		).toBeNull();
	});

	it('accepts surrounding/internal whitespace and any month-name casing in Date', () => {
		const [item] = parseOwenomics(wrap([{ Url: '/a', Date: '  aUgUsT 2026 ' }]));
		expect(item.publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 1) / 1000));
		// Multiple spaces between month and year still parse (\s+).
		const [wide] = parseOwenomics(wrap([{ Url: '/b', Date: 'August  2026' }]));
		expect(wide.publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 1) / 1000));
	});

	it('returns no items for an empty Results array', () => {
		expect(parseOwenomics(wrap([]))).toEqual([]);
	});

	it('throws the documented rejection on invalid JSON (no raw SyntaxError)', () => {
		expect(() => parseOwenomics('{not json')).toThrow(
			/not an Owenomics listing response: invalid JSON/,
		);
		expect(() => parseOwenomics('{not json')).not.toThrow(SyntaxError);
	});

	it('throws the documented rejection on a null/scalar top level', () => {
		// `typeof null === 'object'` but `null` is excluded explicitly; a bare
		// scalar is not an object — both hit the "expected an object" guard.
		expect(() => parseOwenomics('null')).toThrow(/expected an object/);
		expect(() => parseOwenomics('1')).toThrow(/expected an object/);
		expect(() => parseOwenomics('"s"')).toThrow(/expected an object/);
	});

	it('throws the documented rejection when the Results array is absent', () => {
		// An array top level is `typeof 'object'` but carries no `Results` property;
		// so is a real object without one, or one where Results isn't an array. The
		// listing HTML itself (were the endpoint to start serving the page) is
		// invalid JSON and hits the guard above.
		expect(() => parseOwenomics('[]')).toThrow(/missing Results array/);
		expect(() => parseOwenomics('{"TotalPages":5}')).toThrow(/missing Results array/);
		expect(() => parseOwenomics('{"Results":{}}')).toThrow(/missing Results array/);
	});
});
