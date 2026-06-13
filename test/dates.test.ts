import { describe, expect, it } from 'vitest';
import { parseRfc822 } from '../src/ingest/parse/dates';

describe('parseRfc822', () => {
	it('parses an RFC-822 pubDate to unix seconds UTC', () => {
		// Thu, 12 Jun 2026 14:00:00 GMT
		expect(parseRfc822('Thu, 12 Jun 2026 14:00:00 GMT')).toBe(
			Math.floor(Date.UTC(2026, 5, 12, 14, 0, 0) / 1000),
		);
	});

	it('honors numeric timezone offsets', () => {
		// 12:00 -0400 is 16:00 UTC
		expect(parseRfc822('Wed, 10 Jun 2026 12:00:00 -0400')).toBe(
			Math.floor(Date.UTC(2026, 5, 10, 16, 0, 0) / 1000),
		);
	});

	it('parses ISO-8601 dates too', () => {
		expect(parseRfc822('2026-06-12T14:00:00Z')).toBe(
			Math.floor(Date.UTC(2026, 5, 12, 14, 0, 0) / 1000),
		);
	});

	it('returns null for missing or empty input', () => {
		expect(parseRfc822(undefined)).toBeNull();
		expect(parseRfc822(null)).toBeNull();
		expect(parseRfc822('')).toBeNull();
	});

	it('returns null for an unparseable date', () => {
		expect(parseRfc822('not a date')).toBeNull();
	});
});
