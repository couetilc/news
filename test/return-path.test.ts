import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../src/lib/return-path';

// safeReturnPath guards the read/unread toggle's redirect target (#80): the
// client supplies "the view I came from", and the endpoint redirects to it, so
// it MUST be validated to a same-origin, app-relative path or an attacker turns
// the toggle into an open redirect. These cases pin both halves: legit views
// round-trip; anything that could escape the origin falls back to '/'.
describe('safeReturnPath', () => {
	it('keeps a filtered, tabbed home view', () => {
		// The toggle returns to the active tab + source filter (#151); the
		// infinite-scroll offset is deliberately not part of the vocabulary.
		expect(safeReturnPath('/?tab=read&source=ieee-spectrum')).toBe(
			'/?tab=read&source=ieee-spectrum',
		);
	});

	it('preserves repeated ?source params (multi-select filter)', () => {
		expect(safeReturnPath('/?source=apple&source=cloudflare-blog')).toBe(
			'/?source=apple&source=cloudflare-blog',
		);
	});

	it('strips unknown params, keeping only source/tab', () => {
		// `evil` and the retired ?offset cursor are dropped; the known params survive.
		expect(safeReturnPath('/?tab=read&offset=50&evil=1&source=apple')).toBe(
			'/?tab=read&source=apple',
		);
	});

	it('normalizes the bare home path to /', () => {
		expect(safeReturnPath('/')).toBe('/');
	});

	it('drops a query made entirely of unknown params back to /', () => {
		// Path is valid ('/') but no known params remain, so the query collapses.
		expect(safeReturnPath('/?evil=1&foo=bar')).toBe('/');
	});

	it('trims surrounding whitespace before validating', () => {
		expect(safeReturnPath('  /?tab=read  ')).toBe('/?tab=read');
	});

	describe('falls back to / on anything unsafe', () => {
		it.each([
			['a missing (null) value', null],
			['an empty string', ''],
			['a whitespace-only string', '   '],
			// A File upload (not a string) — formData can yield one.
			['a non-string value', new File(['x'], 'x.txt') as unknown as string],
			// Protocol-relative -> //evil.com would navigate cross-origin.
			['a protocol-relative //host', '//evil.com'],
			['a protocol-relative //host with path', '//evil.com/path'],
			// Absolute URLs with a scheme.
			['an https:// absolute URL', 'https://evil.com'],
			['a javascript: URL', 'javascript:alert(1)'],
			// Backslash escape: browsers treat '\' like '/', so /\evil.com is //evil.com.
			['a backslash escape /\\host', '/\\evil.com'],
			['a backslash anywhere in the path', '/foo\\bar'],
			// Not app-relative at all.
			['a bare relative path (no leading slash)', 'foo/bar'],
			// A different app path the toggle should never return to.
			['a deeper app path', '/status'],
			['the api endpoint itself', '/api/read'],
		])('%s', (_label, input) => {
			expect(safeReturnPath(input)).toBe('/');
		});
	});
});
