import { describe, expect, it } from 'vitest';
import {
	PAGE_SIZE,
	hasMore,
	isReadTab,
	nextOffset,
	parseOffset,
	parseTab,
} from '../src/lib/pagination';

describe('parseTab', () => {
	it('defaults a missing or unknown tab to unread', () => {
		// Unread is the default focused view (#151); anything that isn't exactly
		// 'read' falls back to it so a junk ?tab can never break the page.
		expect(parseTab(null)).toBe('unread');
		expect(parseTab('unread')).toBe('unread');
		expect(parseTab('nope')).toBe('unread');
		expect(parseTab('')).toBe('unread');
		expect(parseTab('READ')).toBe('unread'); // exact-match only, not case-folded
	});

	it('reads the read tab', () => {
		expect(parseTab('read')).toBe('read');
	});
});

describe('isReadTab', () => {
	it('maps the read tab to the read=true section flag and unread to false', () => {
		expect(isReadTab('read')).toBe(true);
		expect(isReadTab('unread')).toBe(false);
	});
});

describe('parseOffset', () => {
	it('defaults a missing param to 0 (start of the list)', () => {
		expect(parseOffset(null)).toBe(0);
	});

	it('reads a valid non-negative offset', () => {
		expect(parseOffset('0')).toBe(0);
		expect(parseOffset('50')).toBe(50);
		expect(parseOffset('150')).toBe(150);
		// Surrounding whitespace is tolerated.
		expect(parseOffset('  50  ')).toBe(50);
	});

	it('falls back to 0 for non-numeric, negative, or fractional input', () => {
		expect(parseOffset('abc')).toBe(0);
		expect(parseOffset('')).toBe(0);
		expect(parseOffset('50x')).toBe(0); // trailing junk rejected
		expect(parseOffset('-50')).toBe(0);
		expect(parseOffset('1.5')).toBe(0);
	});
});

describe('hasMore', () => {
	it('is true while the served window has not reached the total', () => {
		// First page of 120: 0 + 50 < 120.
		expect(hasMore(0, PAGE_SIZE, 120)).toBe(true);
		// Second page: 50 + 50 < 120.
		expect(hasMore(50, PAGE_SIZE, 120)).toBe(true);
	});

	it('is false once the window reaches or covers the total — no phantom fetch', () => {
		// Last partial page of 120: 100 + 20 == 120.
		expect(hasMore(100, 20, 120)).toBe(false);
		// An exact multiple: the third full page ends the list.
		expect(hasMore(100, PAGE_SIZE, 150)).toBe(false);
		// A single page that fits the whole section.
		expect(hasMore(0, 30, 30)).toBe(false);
		// An empty section never has more.
		expect(hasMore(0, 0, 0)).toBe(false);
	});
});

describe('nextOffset', () => {
	it('advances the cursor by however many rows the window returned', () => {
		expect(nextOffset(0, PAGE_SIZE)).toBe(50);
		expect(nextOffset(50, PAGE_SIZE)).toBe(100);
		// A short final window still advances by its real length.
		expect(nextOffset(100, 20)).toBe(120);
	});
});
