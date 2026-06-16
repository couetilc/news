import { describe, expect, it } from 'vitest';
import { DROP_FRACTION, validateParse, type ValidateInput } from '../src/ingest/validate';
import type { ParsedItem } from '../src/ingest/types';

// A fully-valid ParsedItem; tests override individual fields to drift it.
function item(overrides: Partial<ParsedItem> = {}): ParsedItem {
	return {
		guid: 'guid-1',
		url: 'https://example.test/1',
		title: 'A title',
		summary: null,
		contentHtml: null,
		publishedAt: 1_700_000_000,
		...overrides,
	};
}

function n(rawCount: number | null, items: ParsedItem[]): ValidateInput {
	return { rawCount, items };
}

describe('validateParse', () => {
	it('returns null for a healthy poll (items present, all fields valid)', () => {
		expect(validateParse(n(2, [item(), item({ guid: 'g2', url: 'u2' })]))).toBeNull();
	});

	it('treats a legitimately empty feed as healthy, not an anomaly (raw 0, parsed 0)', () => {
		// The case the issue insists we DON'T alarm on: nothing came, nothing parsed.
		expect(validateParse(n(0, []))).toBeNull();
	});

	it('returns null when there is no raw counter and the parse produced nothing', () => {
		// Without a denominator we can't call zero-parse drift; with no items there
		// are no fields to check either, so it's quietly healthy.
		expect(validateParse(n(null, []))).toBeNull();
	});

	it('flags the smoking gun: raw entries present but ZERO parsed', () => {
		expect(validateParse(n(3, []))).toEqual({
			kind: 'zero_parsed_of_raw',
			rawCount: 3,
			parsedCount: 0,
		});
	});

	it('flags a sharp drop: kept fewer than DROP_FRACTION of the raw entries', () => {
		// 1 of 10 kept is well under the 0.5 threshold.
		expect(validateParse(n(10, [item()]))).toEqual({
			kind: 'parse_drop',
			rawCount: 10,
			parsedCount: 1,
		});
	});

	it('does NOT flag a drop at exactly the DROP_FRACTION boundary', () => {
		// parsedCount === rawCount * DROP_FRACTION is tolerated (strict <), so 5 of 10
		// is healthy churn, not drift.
		const kept = Array.from({ length: 10 * DROP_FRACTION }, (_v, i) =>
			item({ guid: `g${i}`, url: `https://example.test/${i}` }),
		);
		expect(validateParse(n(10, kept))).toBeNull();
	});

	it('flags an item missing a required field (empty title)', () => {
		expect(validateParse(n(1, [item({ title: '' })]))).toEqual({
			kind: 'missing_required_fields',
			rawCount: 1,
			parsedCount: 1,
			missingFields: ['title'],
			invalidCount: 1,
		});
	});

	it('reports every distinct bad field, sorted, and counts offending items', () => {
		const bad = validateParse(
			n(2, [item({ guid: '', title: '' }), item({ url: '' })]),
		);
		expect(bad).toMatchObject({
			kind: 'missing_required_fields',
			invalidCount: 2,
		});
		// Sorted, de-duplicated union of the violations across both items.
		expect(bad?.missingFields).toEqual(['guid', 'title', 'url']);
	});

	it('runs field validation even without a raw counter (rawCount null)', () => {
		expect(validateParse(n(null, [item({ url: '' })]))).toEqual({
			kind: 'missing_required_fields',
			rawCount: null,
			parsedCount: 1,
			missingFields: ['url'],
			invalidCount: 1,
		});
	});

	it('accepts a null publishedAt (feeds legitimately omit dates)', () => {
		expect(validateParse(n(1, [item({ publishedAt: null })]))).toBeNull();
	});

	it('flags an implausible future date (e.g. milliseconds mistaken for seconds)', () => {
		// 1.7e12 reads as the year ~55,000 in unix seconds — a unit mix-up.
		expect(validateParse(n(1, [item({ publishedAt: 1_700_000_000_000 })]))).toMatchObject({
			kind: 'missing_required_fields',
			missingFields: ['publishedAt'],
			invalidCount: 1,
		});
	});

	it('flags a negative (pre-epoch) date', () => {
		expect(validateParse(n(1, [item({ publishedAt: -1 })]))).toMatchObject({
			kind: 'missing_required_fields',
			missingFields: ['publishedAt'],
		});
	});

	it('flags a non-finite date (NaN)', () => {
		expect(validateParse(n(1, [item({ publishedAt: Number.NaN })]))).toMatchObject({
			kind: 'missing_required_fields',
			missingFields: ['publishedAt'],
		});
	});

	it('prefers the zero-parse verdict over field checks when nothing parsed', () => {
		// Belt-and-suspenders: with 0 items there are no fields to inspect, so the
		// zero-parse branch is the only verdict possible — this pins that ordering.
		expect(validateParse(n(5, []))?.kind).toBe('zero_parsed_of_raw');
	});
});
