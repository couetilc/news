import { describe, expect, it } from 'vitest';
import { PAGE_SIZE, isReadTab, parseTab, itemCursor, encodeCursor, parseCursor } from '../src/lib/pagination';

describe('feed pagination', () => {
	it('defaults unknown tabs to unread and recognizes read', () => {
		for (const raw of [null, '', 'unread', 'READ', 'junk']) expect(parseTab(raw)).toBe('unread');
		expect(parseTab('read')).toBe('read');
		expect(isReadTab('read')).toBe(true);
		expect(isReadTab('unread')).toBe(false);
		expect(PAGE_SIZE).toBe(50);
	});
	it('uses publication time including zero, falling back to fetch time only when absent', () => {
		expect(itemCursor({ id: 2, published_at: 0, fetched_at: 30 })).toEqual({ time: 0, id: 2 });
		expect(itemCursor({ id: 2, published_at: null, fetched_at: 30 })).toEqual({ time: 30, id: 2 });
	});
	it('round trips fractional, negative, boundary and undated timestamps without losing precision', () => {
		expect(parseCursor(null)).toBeUndefined();
		for (const time of [0, -100, 1723456789.123, -8.64e12, 8.64e12, 1e-7]) {
			const cursor = { time, id: Number.MAX_SAFE_INTEGER };
			expect(parseCursor(encodeCursor(cursor))).toEqual(cursor);
		}
	});
	it.each(['', 'junk', 'null', '{}', '1', '[1]', '[1,2,3]', '["1",2]', '[1,"2"]', '[1e400,2]', '[8640000000001,2]', '[1,1.5]', '[1,9007199254740992]', '[1,0]', '[1,-1]', '9'.repeat(400)])('rejects malformed or unbounded input %s', raw => {
		expect(parseCursor(raw)).toBeNull();
	});
});
