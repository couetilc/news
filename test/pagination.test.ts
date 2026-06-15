import { describe, expect, it } from 'vitest';
import {
	PAGE_SIZE,
	clampPage,
	offsetFor,
	pageHref,
	parsePage,
	totalPages,
} from '../src/lib/pagination';

describe('parsePage', () => {
	it('defaults a missing param to page 1', () => {
		expect(parsePage(null)).toBe(1);
	});

	it('reads a valid 1-based page', () => {
		expect(parsePage('1')).toBe(1);
		expect(parsePage('7')).toBe(7);
		// Surrounding whitespace is tolerated.
		expect(parsePage('  3  ')).toBe(3);
	});

	it('falls back to 1 for non-numeric, zero, negative, or fractional input', () => {
		expect(parsePage('abc')).toBe(1);
		expect(parsePage('')).toBe(1);
		expect(parsePage('2x')).toBe(1); // trailing junk rejected
		expect(parsePage('0')).toBe(1);
		expect(parsePage('-3')).toBe(1);
		expect(parsePage('1.5')).toBe(1);
	});
});

describe('totalPages', () => {
	it('is at least 1, even for an empty section', () => {
		expect(totalPages(0)).toBe(1);
	});

	it('rounds up partial pages', () => {
		expect(totalPages(1)).toBe(1);
		expect(totalPages(PAGE_SIZE)).toBe(1);
		expect(totalPages(PAGE_SIZE + 1)).toBe(2);
		expect(totalPages(PAGE_SIZE * 2)).toBe(2);
		expect(totalPages(PAGE_SIZE * 2 + 1)).toBe(3);
	});
});

describe('clampPage', () => {
	it('passes through a page within range', () => {
		expect(clampPage(1, 120)).toBe(1);
		expect(clampPage(2, 120)).toBe(2);
		expect(clampPage(3, 120)).toBe(3);
	});

	it('clamps a page past the last onto the last page', () => {
		expect(clampPage(99, 120)).toBe(3);
		// Empty section: the last page is 1.
		expect(clampPage(5, 0)).toBe(1);
	});
});

describe('offsetFor', () => {
	it('maps a 1-based page to a row offset', () => {
		expect(offsetFor(1)).toBe(0);
		expect(offsetFor(2)).toBe(PAGE_SIZE);
		expect(offsetFor(3)).toBe(PAGE_SIZE * 2);
	});
});

describe('pageHref', () => {
	it('omits the param entirely for page 1 (clean default URL)', () => {
		expect(pageHref([], 'unread', 1, null)).toBe('/');
	});

	it('writes only this section param past page 1', () => {
		expect(pageHref([], 'unread', 2, null)).toBe('/?unread=2');
		expect(pageHref([], 'read', 3, null)).toBe('/?read=3');
	});

	it('carries the active source filter', () => {
		expect(pageHref(['a'], 'unread', 2, null)).toBe('/?source=a&unread=2');
		expect(pageHref(['a', 'b'], 'read', 2, null)).toBe('/?source=a&source=b&read=2');
	});

	it('preserves the sibling cursor only when it is past page 1', () => {
		// Sibling on page 1 is the default — omit it.
		expect(pageHref([], 'unread', 2, { param: 'read', page: 1 })).toBe('/?unread=2');
		// Sibling past page 1 is carried.
		expect(pageHref([], 'unread', 2, { param: 'read', page: 3 })).toBe('/?read=3&unread=2');
	});

	it('combines source filter and sibling cursor', () => {
		expect(pageHref(['x'], 'unread', 2, { param: 'read', page: 4 })).toBe(
			'/?source=x&read=4&unread=2',
		);
	});
});
