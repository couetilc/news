import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { sectionWhere, sourceWhere } from '../src/ingest/queries';

// Tests for the pure SQL-clause decisions (#349) extracted from db.ts. The
// clauses ARE the contract — db.ts interpolates them verbatim and binds one
// value per `?` — so these pin the exact strings, and a property keeps the
// placeholder count in lockstep with the bind list for any filter length.
// db.test.ts (workers project) proves the composed queries behave on real D1.
const SEED = 0x163;

describe('sourceWhere (listItems filter)', () => {
	it('no filter → no WHERE clause at all', () => {
		expect(sourceWhere([])).toBe('');
	});

	it('one placeholder per selected source, comma-joined', () => {
		expect(sourceWhere(['aws'])).toBe('WHERE source IN (?)');
		expect(sourceWhere(['aws', 'cf'])).toBe('WHERE source IN (?, ?)');
	});
});

describe('sectionWhere (per-user read/unread partition)', () => {
	it('picks the partition off the per-user LEFT JOIN row: exact complements', () => {
		expect(sectionWhere(false, [])).toBe('WHERE r.read_at IS NULL');
		expect(sectionWhere(true, [])).toBe('WHERE r.read_at IS NOT NULL');
	});

	it('appends the source filter WITHIN the section', () => {
		expect(sectionWhere(false, ['aws'])).toBe('WHERE r.read_at IS NULL AND i.source IN (?)');
		expect(sectionWhere(true, ['aws', 'cf'])).toBe(
			'WHERE r.read_at IS NOT NULL AND i.source IN (?, ?)',
		);
	});
});

describe('placeholder count tracks the bind list — property', () => {
	const count = (sql: string): number => (sql.match(/\?/g) ?? []).length;

	it('both builders emit exactly sources.length placeholders', () => {
		fc.assert(
			fc.property(fc.array(fc.string(), { maxLength: 10 }), fc.boolean(), (sources, read) => {
				expect(count(sourceWhere(sources))).toBe(sources.length);
				expect(count(sectionWhere(read, sources))).toBe(sources.length);
				// The read partition is decided by the flag alone, never the filter.
				expect(sectionWhere(read, sources).includes('IS NOT NULL')).toBe(read);
			}),
			{ seed: SEED },
		);
	});
});
