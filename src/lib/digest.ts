import { isReadTab, type Tab } from './pagination';
import { sourceMeta } from './sources';

// Pure digest-assembly decisions (#349), extracted from index.astro /
// feed.astro / db.ts so the pages and the data layer keep only plumbing. The
// ordering, partition, and counting of the digest itself live in SQL (db.ts)
// and are pinned against real D1 by test/db.test.ts; what's here is the JS-side
// decision logic around those queries — node-tested (test/digest.test.ts +
// test/digest.prop.test.ts) and in Stryker's mutation scope.

// Intersect the ?source params with the sources actually present, preserving
// request order: an unknown or absent slug just drops out, so a hand-crafted
// URL can never 500 — and an empty result means "All", never "nothing".
export function activeSourceFilter(
	requested: readonly string[],
	present: readonly string[],
): string[] {
	const presentSet = new Set(present);
	return requested.filter((s) => presentSet.has(s));
}

// The filter bar's ordering: source slugs sorted by their display name (via the
// registry), for a stable, human-sensible bar. Non-mutating.
export function orderSourcesByName(slugs: readonly string[]): string[] {
	return [...slugs].sort((a, b) => sourceMeta(a).name.localeCompare(sourceMeta(b).name));
}

// Which section total bounds the active tab's infinite scroll (#151).
export function pickSectionTotal(tab: Tab, unreadTotal: number, readTotal: number): number {
	return isReadTab(tab) ? readTotal : unreadTotal;
}

// The Recently-viewed lane (#334) renders only for a logged-in reader on the
// Unread tab — on the Read tab every lane row would duplicate the history right
// below it, and an anonymous visitor has no read state at all.
export function showRecentlyViewed(isAuthed: boolean, tab: Tab): boolean {
	return isAuthed && !isReadTab(tab);
}

// The active tab's empty-state copy: a source filter with no matches gets the
// "from this source" line (so the reader knows to clear it); otherwise the
// plain per-tab caught-up/none-read message. "Nothing aggregated yet" (no
// sources at all) is a separate case the page handles via `present`.
export function emptyMessage(tab: Tab, filtered: boolean): string {
	return isReadTab(tab)
		? filtered
			? 'Nothing read from this source yet.'
			: 'Nothing read yet.'
		: filtered
			? 'Nothing unread from this source.'
			: 'All caught up — nothing unread.';
}

// Where a read/unread toggle in a /feed fragment row returns to: the top of the
// active tab + source filter (the offset is deliberately dropped — see
// safeReturnPath), so the reader lands back on the same view, not the
// unfiltered home (#80).
export function feedReturnTo(tab: Tab, sources: readonly string[]): string {
	const params = new URLSearchParams();
	params.set('tab', tab);
	for (const s of sources) params.append('source', s);
	return `/?${params.toString()}`;
}
