import { describe, expect, it } from 'vitest';
import { parseJpmEotm } from '../src/ingest/parse/jpm-eotm';
import eotmJson from './fixtures/eye-on-the-market.json?raw';

// #319 — JPMorgan Asset Management "Eye on the Market" (Michael Cembalest). The
// page renders its article stream client-side from an AEM editorial-landing
// `.model.json` (a JSON object whose `pages` array holds the records, newest
// first). parseJpmEotm reads `pages`, resolves the relative article url to an
// absolute one (the guid), keeps the teaser as the summary, links out (contentHtml
// null), and converts the epoch-MILLISECONDS sortDate to unix seconds.

describe('parseJpmEotm — real model.json shape (fixture)', () => {
	const items = parseJpmEotm(eotmJson);

	it('extracts every page record in feed order (newest first)', () => {
		expect(items.map((i) => i.title)).toEqual([
			'Semiquincententacles',
			// `&#39;` and `&amp;` in the source decode to plain text.
			"Home Alone: inflation and the new Fed chair; investing in China's AI ecosystem; Prediction markets",
			'Fighting Words: The Energy Transition in 2026',
		]);
	});

	it('resolves a site-relative url to an absolute am.jpmorgan.com URL, used as guid', () => {
		expect(items[0].url).toBe(
			'https://am.jpmorgan.com/us/en/asset-management/institutional/insights/market-insights/eye-on-the-market/semiquincententacles/',
		);
		// guid === url: the article page is the stable dedupe key (#191).
		expect(items[0].guid).toBe(items[0].url);
	});

	it('passes an already-absolute url through unchanged (no double origin prefix)', () => {
		expect(items[2].url).toBe(
			'https://am.jpmorgan.com/us/en/asset-management/institutional/insights/market-insights/eye-on-the-market/energy-paper-2026/',
		);
		expect(items[2].url).not.toContain('am.jpmorgan.comhttps');
	});

	it('keeps the teaser description as the summary and links out (contentHtml null)', () => {
		expect(items[0].summary).toMatch(/^Behold the Aquilaceph/);
		expect(items[0].contentHtml).toBeNull();
	});

	it('decodes HTML entities in the title and the summary (#224)', () => {
		expect(items[1].title).toContain("China's AI ecosystem");
		expect(items[1].title).not.toContain('&#39;');
		expect(items[1].summary).toContain('equity risk premia & pressure');
		expect(items[1].summary).not.toContain('&amp;');
	});

	it('converts the epoch-milliseconds sortDate to unix seconds', () => {
		// 1782219660000 ms → 1782219660 s == 2026-06-23T13:01:00Z.
		expect(items[0].publishedAt).toBe(1782219660);
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 23, 13, 1, 0) / 1000));
	});

	it('yields the full ParsedItem shape for a record', () => {
		expect(items[0]).toEqual({
			guid: 'https://am.jpmorgan.com/us/en/asset-management/institutional/insights/market-insights/eye-on-the-market/semiquincententacles/',
			url: 'https://am.jpmorgan.com/us/en/asset-management/institutional/insights/market-insights/eye-on-the-market/semiquincententacles/',
			title: 'Semiquincententacles',
			summary:
				'Behold the Aquilaceph, half-bald eagle and half-octopus. On the semiquincentennial 250th anniversary of the US Declaration of Independence, this imaginary beast is a metaphor for the continued US grip on financial markets.',
			contentHtml: null,
			publishedAt: 1782219660,
		});
	});
});

describe('parseJpmEotm — edge cases and the parser-robustness contract (#165)', () => {
	const wrap = (pages: unknown) => JSON.stringify({ pages });

	it('skips a record with no url (nothing stable to dedupe on)', () => {
		const items = parseJpmEotm(
			wrap([{ title: 'No link', description: 'orphan', sortDate: 1000 }]),
		);
		expect(items).toEqual([]);
	});

	it('skips a null/non-object array element without crashing', () => {
		const items = parseJpmEotm(wrap([null, 7, 'x', { url: '/keep/', title: 'Kept' }]));
		expect(items.map((i) => i.title)).toEqual(['Kept']);
		expect(items[0].url).toBe('https://am.jpmorgan.com/keep/');
	});

	it('defaults a missing title to an empty string', () => {
		const [item] = parseJpmEotm(wrap([{ url: '/a/' }]));
		expect(item.title).toBe('');
	});

	it('leaves summary null when description is missing or empty', () => {
		const [item] = parseJpmEotm(wrap([{ url: '/a/', description: '' }]));
		expect(item.summary).toBeNull();
	});

	it('treats a whitespace-only / entity-only title and description as null after decoding', () => {
		// A non-empty-but-blank string passes the textOf guard, then decodes+trims to
		// empty: title falls back to '' and summary becomes null (not "   ").
		const [item] = parseJpmEotm(
			wrap([{ url: '/a/', title: '  ', description: '&nbsp; ' }]),
		);
		expect(item.title).toBe('');
		expect(item.summary).toBeNull();
	});

	it('leaves publishedAt null when sortDate is missing or not a finite number', () => {
		expect(parseJpmEotm(wrap([{ url: '/a/' }]))[0].publishedAt).toBeNull();
		expect(parseJpmEotm(wrap([{ url: '/b/', sortDate: 'soon' }]))[0].publishedAt).toBeNull();
		expect(parseJpmEotm(wrap([{ url: '/c/', sortDate: null }]))[0].publishedAt).toBeNull();
	});

	it('returns no items for an empty pages array', () => {
		expect(parseJpmEotm(wrap([]))).toEqual([]);
	});

	it('throws the documented rejection on invalid JSON (no raw SyntaxError)', () => {
		expect(() => parseJpmEotm('{not json')).toThrow(
			/not a JPM Eye on the Market response: invalid JSON/,
		);
		expect(() => parseJpmEotm('{not json')).not.toThrow(SyntaxError);
	});

	it('throws the documented rejection on a null/scalar top level', () => {
		// `typeof null === 'object'` but `null` is excluded explicitly; a bare scalar
		// is not an object — both hit the "expected an object" guard.
		expect(() => parseJpmEotm('null')).toThrow(/expected an object/);
		expect(() => parseJpmEotm('1')).toThrow(/expected an object/);
		expect(() => parseJpmEotm('"s"')).toThrow(/expected an object/);
	});

	it('throws the documented rejection when the pages array is absent', () => {
		// An array top level is `typeof 'object'` but carries no `pages` property, so
		// it falls through to the missing-pages guard — as does a real object without
		// a pages array, or one where pages isn't an array.
		expect(() => parseJpmEotm('[]')).toThrow(/missing pages array/);
		expect(() => parseJpmEotm('{"headline":"Eye on the Market"}')).toThrow(
			/missing pages array/,
		);
		expect(() => parseJpmEotm('{"pages":{}}')).toThrow(/missing pages array/);
	});
});
