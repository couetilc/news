import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

// Migration 0006 (#191) is the highest-risk part of PR #193: before creating the
// UNIQUE (source, url) index it MUTATES production data — copies read marks off
// each doomed duplicate onto the surviving (lowest-id) row, deletes the duplicate
// `items`, then deletes now-orphaned `item_reads`. The committed db.test.ts cases
// only cover FUTURE insert dedup against an already-migrated DB; the per-file
// setup applies 0006 against an empty table (a no-op). Neither exercises the
// data-mutation body. This suite seeds a genuine pre-index duplicate shape and
// reruns the SHIPPED 0006 SQL — pulled straight from the TEST_MIGRATIONS binding,
// not a hand-copied paraphrase — to lock in that mutation as a regression test.
//
// readD1Migrations splits 0006 into four statements (copy reads / delete dupes /
// delete orphans / create index); we run them in order, exactly as a real
// migration would. Because the test DB already has the index applied, we DROP it
// in beforeEach to reconstruct the pre-0006 schema and let the duplicate rows
// exist; statement four recreates it, so the post-run assertions see the real
// finished state — including the index rejecting a new (source, url) collision.

const db = env.NEWS_DB;

const migration0006Queries = (): string[] => {
	const m = env.TEST_MIGRATIONS.find((mig) => mig.name === '0006_dedupe_items_by_url.sql');
	if (!m) throw new Error('0006 dedupe migration not found in TEST_MIGRATIONS');
	// One entry per SQL statement; keep newlines so the leading `--` line comments
	// terminate at end-of-line rather than commenting out the statement body.
	return m.queries.map((q) => q);
};

// Run the real migration body in committed order.
const runMigration = async (): Promise<void> => {
	await db.batch(migration0006Queries().map((q) => db.prepare(q)));
};

// Seed a row directly (bypassing insertItems' ON CONFLICT) so we can plant
// genuine (source, url) duplicates the way pre-0006 production data looked.
const addItem = (over: {
	id: number;
	source: string;
	guid: string;
	url: string;
}): Promise<unknown> =>
	db
		.prepare(
			'INSERT INTO items (id, source, guid, url, title, fetched_at) VALUES (?, ?, ?, ?, ?, ?)',
		)
		.bind(over.id, over.source, over.guid, over.url, 'Title', 1000)
		.run();

const addRead = (userId: number, itemId: number, readAt: number): Promise<unknown> =>
	db
		.prepare('INSERT INTO item_reads (user_id, item_id, read_at) VALUES (?, ?, ?)')
		.bind(userId, itemId, readAt)
		.run();

const readsFor = async (itemId: number): Promise<{ user_id: number; read_at: number }[]> => {
	const { results } = await db
		.prepare('SELECT user_id, read_at FROM item_reads WHERE item_id = ? ORDER BY user_id')
		.bind(itemId)
		.all<{ user_id: number; read_at: number }>();
	return results;
};

const itemIds = async (): Promise<number[]> => {
	const { results } = await db
		.prepare('SELECT id FROM items ORDER BY id')
		.all<{ id: number }>();
	return results.map((r) => r.id);
};

beforeEach(async () => {
	// Reconstruct the pre-0006 schema: drop the UNIQUE (source, url) index that the
	// per-file migration setup already created, so duplicate rows can be planted.
	// (Statement four of the migration recreates it.)
	await db.exec('DROP INDEX IF EXISTS items_source_url');
	await db.batch([
		db.prepare('DELETE FROM item_reads'),
		db.prepare('DELETE FROM items'),
		db.prepare('DELETE FROM users'),
	]);
});

describe('0006 dedupe_items_by_url (#191) — data-migration body', () => {
	it('keeps the lowest-id survivor, re-points read marks onto it, drops dupes + orphans, and arms the index', async () => {
		// A genuine pre-0006 duplicate group: same (source=nvidia, url) under two
		// drifted guids — the exact NVIDIA WordPress shape #191 describes. id 10 is
		// the survivor (lowest id); ids 11 and 12 are the doomed duplicates.
		const URL = 'https://blogs.nvidia.com/blog/x/';
		await addItem({ id: 10, source: 'nvidia', guid: `${URL}`, url: URL }); // survivor
		await addItem({ id: 11, source: 'nvidia', guid: 'https://blogs.nvidia.com/?p=94478', url: URL });
		await addItem({ id: 12, source: 'nvidia', guid: 'https://blogs.nvidia.com/?p=94479', url: URL });
		// A genuinely distinct item: same URL but a DIFFERENT source must survive
		// untouched — the dedup key is per-source.
		await addItem({ id: 20, source: 'aws', guid: 'aws-1', url: URL });
		// And an unrelated item under nvidia (different url) that is no duplicate.
		await addItem({ id: 30, source: 'nvidia', guid: 'g-other', url: 'https://blogs.nvidia.com/blog/y/' });

		// Read marks spread across MORE THAN ONE row of the duplicate group, plus a
		// conflicting mark already on the survivor for one user:
		//  - user 1 read the survivor (10) at t=100 AND a doomed dupe (11) at t=999.
		//    ON CONFLICT must KEEP the survivor's existing 100, not clobber it to 999.
		//  - user 2 read only a doomed dupe (12) at t=200 — that mark must be
		//    re-pointed onto the survivor (10), so user 2 doesn't lose read state.
		//  - user 3 read the cross-source item (20); it must be left exactly as-is.
		await addRead(1, 10, 100);
		await addRead(1, 11, 999);
		await addRead(2, 12, 200);
		await addRead(3, 20, 300);

		await runMigration();

		// Only the survivor of each (source, url) group remains: 10 (nvidia/URL),
		// 20 (aws/URL, distinct source), 30 (nvidia/other url). 11 and 12 are gone.
		expect(await itemIds()).toEqual([10, 20, 30]);

		// Read marks consolidated onto the survivor (10): user 1 kept their original
		// survivor timestamp (100, NOT the dupe's 999 — ON CONFLICT DO NOTHING), and
		// user 2's mark was carried forward from the deleted dupe (12 → 10) at 200.
		expect(await readsFor(10)).toEqual([
			{ user_id: 1, read_at: 100 },
			{ user_id: 2, read_at: 200 },
		]);

		// The cross-source item's read mark is untouched.
		expect(await readsFor(20)).toEqual([{ user_id: 3, read_at: 300 }]);

		// No read marks survive pointing at a deleted duplicate (11, 12 gone) —
		// the orphan-cleanup step removed them; nothing dangles.
		const orphanCount = await db
			.prepare('SELECT COUNT(*) AS n FROM item_reads WHERE item_id NOT IN (SELECT id FROM items)')
			.first<number>('n');
		expect(orphanCount).toBe(0);
		// Total read rows: user1@10, user2@10, user3@20 = 3 (down from 4 seeded).
		const total = await db.prepare('SELECT COUNT(*) AS n FROM item_reads').first<number>('n');
		expect(total).toBe(3);

		// The UNIQUE (source, url) index now exists and is armed: a fresh insert
		// colliding on (nvidia, URL) is rejected. INSERT OR IGNORE proves the index
		// constraint fires (a plain INSERT would throw; either way the row count
		// must not grow).
		await db
			.prepare(
				"INSERT OR IGNORE INTO items (source, guid, url, title, fetched_at) VALUES ('nvidia', 'g-new', ?, 'Title', 2000)",
			)
			.bind(URL)
			.run();
		expect(await itemIds()).toEqual([10, 20, 30]);

		const indexRow = await db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'items_source_url'")
			.first<{ name: string }>();
		expect(indexRow?.name).toBe('items_source_url');
	});

	it('re-points the read mark of a deleted dupe forward when the user never touched the survivor', async () => {
		// A duplicate group whose only read mark sits on the doomed dupe, for a user
		// who never touched the survivor: it must be re-pointed onto the survivor
		// (step 1), not dropped by the orphan sweep (step 3). Proves no read state is
		// lost when the survivor had no prior mark for that user.
		const URL = 'https://example.com/a';
		await addItem({ id: 1, source: 's', guid: 'g-keep', url: URL }); // survivor
		await addItem({ id: 2, source: 's', guid: 'g-dupe', url: URL }); // deleted
		await addRead(5, 2, 700);

		await runMigration();

		expect(await itemIds()).toEqual([1]);
		// Re-pointed forward, not dropped: user 5 keeps read state on the survivor.
		expect(await readsFor(1)).toEqual([{ user_id: 5, read_at: 700 }]);
		const total = await db.prepare('SELECT COUNT(*) AS n FROM item_reads').first<number>('n');
		expect(total).toBe(1);
	});
});
