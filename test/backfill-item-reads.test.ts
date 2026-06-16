import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { insertItems, listItems, listItemsByRead } from '../src/ingest/db';
import type { ParsedItem } from '../src/ingest/types';

// Backfill migration 0005 (#139): copies legacy global items.read_at marks into
// the per-user item_reads table for the SOLE existing user. The migration is
// already applied (against an empty DB, a no-op) by the per-file setup; this
// suite re-runs its real SQL — pulled straight from the TEST_MIGRATIONS binding,
// so the assertions exercise the shipped statement, not a hand-copied paraphrase
// — against seeded data to prove the copy, idempotency, and the user-count guard.

const db = env.NEWS_DB;

const backfillSql = (): string => {
	const m = env.TEST_MIGRATIONS.find((mig) => mig.name === '0005_backfill_item_reads.sql');
	if (!m) throw new Error('0005 backfill migration not found in TEST_MIGRATIONS');
	// readD1Migrations keeps leading `--` comment lines inline with the single
	// statement; run with newlines intact so those line comments terminate at
	// end-of-line and the trailing INSERT executes (flattening them would comment
	// the whole statement out). One statement → prepare().run().
	return m.queries.join('\n');
};
const runBackfill = () => db.prepare(backfillSql()).run();

const item = (over: Partial<ParsedItem>): ParsedItem => ({
	guid: 'g1',
	url: 'https://example.com/a',
	title: 'Title',
	summary: null,
	contentHtml: null,
	publishedAt: 1000,
	...over,
});

// Insert a user with a fixed id so the backfill's "sole user" can be asserted by id.
const addUser = async (id: number, email: string): Promise<void> => {
	await db
		.prepare('INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
		.bind(id, email, 'pbkdf2$1$x$y', 1000)
		.run();
};

// Set the legacy global read mark on an item by guid.
const markGlobalRead = async (guid: string, at: number): Promise<void> => {
	await db.prepare('UPDATE items SET read_at = ? WHERE guid = ?').bind(at, guid).run();
};

beforeEach(async () => {
	await db.batch([
		db.prepare('DELETE FROM item_reads'),
		db.prepare('DELETE FROM items'),
		db.prepare('DELETE FROM users'),
	]);
});

describe('0005 backfill_item_reads (#139)', () => {
	it('copies every legacy global read mark to the sole user, leaving unread items untouched', async () => {
		const USER = 7;
		await addUser(USER, 'solo@example.com');
		await insertItems(db, 's', [
			item({ guid: 'r1', publishedAt: 3000 }),
			item({ guid: 'r2', publishedAt: 2000 }),
			item({ guid: 'u1', publishedAt: 1000 }),
		], 100);
		await markGlobalRead('r1', 5000);
		await markGlobalRead('r2', 6000);
		// u1 stays unread (read_at IS NULL).

		await runBackfill();

		const byGuid = Object.fromEntries((await listItems(db, 100)).map((i) => [i.guid, i.id]));
		const read = await listItemsByRead(db, { userId: USER, read: true, limit: 100, offset: 0 });
		// Exactly the two legacy-read items are now read for the sole user, each
		// carrying its original legacy timestamp.
		expect(read.map((r) => r.id).sort((a, b) => a - b)).toEqual(
			[byGuid.r1, byGuid.r2].sort((a, b) => a - b),
		);
		const tsByGuid = Object.fromEntries(
			read.map((r) => [Object.keys(byGuid).find((g) => byGuid[g] === r.id), r.read_at]),
		);
		expect(tsByGuid).toEqual({ r1: 5000, r2: 6000 });

		// The unread item is still unread; no spurious rows were created.
		const unread = await listItemsByRead(db, { userId: USER, read: false, limit: 100, offset: 0 });
		expect(unread.map((r) => r.id)).toEqual([byGuid.u1]);
		const total = await db.prepare('SELECT COUNT(*) AS n FROM item_reads').first<number>('n');
		expect(total).toBe(2);
	});

	it('is idempotent and never clobbers a read the user already set via the app', async () => {
		const USER = 7;
		await addUser(USER, 'solo@example.com');
		await insertItems(db, 's', [item({ guid: 'r1', publishedAt: 1000 })], 100);
		await markGlobalRead('r1', 5000);
		const [{ id }] = await listItems(db, 1);

		// The user already marked r1 read in-app at a DIFFERENT timestamp.
		await db
			.prepare('INSERT INTO item_reads (user_id, item_id, read_at) VALUES (?, ?, ?)')
			.bind(USER, id, 9999)
			.run();

		// Running the backfill twice neither duplicates nor overwrites that row.
		await runBackfill();
		await runBackfill();

		const rows = await db
			.prepare('SELECT read_at FROM item_reads WHERE user_id = ? AND item_id = ?')
			.bind(USER, id)
			.all<{ read_at: number }>();
		expect(rows.results.map((r) => r.read_at)).toEqual([9999]); // kept, not 5000
	});

	it('is a no-op with more than one user — no owner to guess', async () => {
		await addUser(1, 'a@example.com');
		await addUser(2, 'b@example.com');
		await insertItems(db, 's', [item({ guid: 'r1' })], 100);
		await markGlobalRead('r1', 5000);

		await runBackfill();

		const total = await db.prepare('SELECT COUNT(*) AS n FROM item_reads').first<number>('n');
		expect(total).toBe(0);
	});

	it('is a no-op with zero users — nothing to attribute', async () => {
		await insertItems(db, 's', [item({ guid: 'r1' })], 100);
		await markGlobalRead('r1', 5000);

		await runBackfill();

		const total = await db.prepare('SELECT COUNT(*) AS n FROM item_reads').first<number>('n');
		expect(total).toBe(0);
	});
});
