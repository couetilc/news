import fc from 'fast-check';
import { expect, it } from 'vitest';
import { parseCursor, encodeCursor, parseTab } from '../src/lib/pagination';

const seed = 0x163;
it('round trips generated valid cursors without rounding dates or ids', () => {
	fc.assert(fc.property(
		fc.integer({ min: -8.64e12, max: 8.64e12 }).map(ms => ms / 1000),
		fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }),
		(time, id) => { expect(parseCursor(encodeCursor({ time, id }))).toEqual({ time, id }); },
	), { seed, numRuns: 500 });
});
it('arbitrary strings and JSON either reject or yield bounded numeric SQL parameters', () => {
	fc.assert(fc.property(fc.oneof(fc.string(), fc.json()), raw => {
		const value = parseCursor(raw);
		if (value) {
			expect(Number.isFinite(value.time)).toBe(true);
			expect(Math.abs(value.time)).toBeLessThanOrEqual(8.64e12);
			expect(Number.isSafeInteger(value.id)).toBe(true);
			expect(value.id).toBeGreaterThan(0);
		} else expect(value).toBeNull();
	}), { seed, numRuns: 500 });
});
it('unknown tab strings always select a supported partition', () => {
	fc.assert(fc.property(fc.option(fc.string(), { nil: null }), raw => {
		expect(['read', 'unread']).toContain(parseTab(raw));
	}), { seed });
});
