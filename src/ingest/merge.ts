import type { ParsedItem } from './types';

// Pure dedup/merge decisions (#349): the meaning of what one source's poll
// stores, as plain functions over data. Two pieces:
//
//   • keepItems — the editorial keep filter (#321), applied by run.ts after the
//     shape-drift check and before the writes.
//   • planItemInserts — the pure meaning of insertItems' bare
//     `ON CONFLICT DO NOTHING` under the items table's two per-source unique
//     keys, (source, guid) and (source, url) (#191): which incoming items are
//     new rows and which are skips.
//
// The SQL in db.ts stays the production implementation (the ON CONFLICT *is*
// the dedupe); this module is its executable specification. The workers-project
// parity block in test/db.test.ts drives both against the same scenarios and
// asserts D1 agrees with the plan, and the ingest-algebra property suite
// (test/merge.prop.test.ts) proves the idempotence/commutativity the issue
// names against this core — properties the workerd pool is too slow to fuzz.

// The keys one source already occupies: an incoming item colliding with either
// set is a duplicate of a stored row.
export interface SourceKeys {
	guids: ReadonlySet<string>;
	urls: ReadonlySet<string>;
}

export interface InsertPlan {
	inserts: ParsedItem[];
	skips: ParsedItem[];
}

// The editorial filter (#321): a feed's optional `keep` predicate drops parsed
// noise; a feed without one keeps everything it parsed.
export function keepItems(
	keep: ((item: ParsedItem) => boolean) | undefined,
	items: ParsedItem[],
): ParsedItem[] {
	return keep ? items.filter(keep) : items;
}

// Partition one source's incoming batch into inserts and skips, exactly as a
// sequence of `INSERT … ON CONFLICT DO NOTHING` statements resolves it: an item
// is a skip when its guid OR url is already claimed — by a stored row (the
// `existing` keys) or by an EARLIER item in the same batch (an inserted item
// claims both its keys, so in-batch order decides which of two partially
// colliding items wins, just as statement order does in the D1 batch). Both
// output lists preserve the incoming order.
export function planItemInserts(
	existing: SourceKeys,
	incoming: readonly ParsedItem[],
): InsertPlan {
	const guids = new Set(existing.guids);
	const urls = new Set(existing.urls);
	const inserts: ParsedItem[] = [];
	const skips: ParsedItem[] = [];
	for (const item of incoming) {
		if (guids.has(item.guid) || urls.has(item.url)) {
			skips.push(item);
			continue;
		}
		guids.add(item.guid);
		urls.add(item.url);
		inserts.push(item);
	}
	return { inserts, skips };
}
