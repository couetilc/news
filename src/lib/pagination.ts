// Pagination math for the homepage feed (#151). The feed is two tabs — Unread
// and Read — each an infinite-scroll list that loads 50 items at a time. The
// first page renders server-side in index.astro; subsequent pages are fetched
// from /api/feed as the reader scrolls. Both the page and the partial endpoint
// page by OFFSET at PAGE_SIZE/page, so the offset/cursor math lives here (out of
// the .astro/endpoint code) and is unit-tested directly while the templates stay
// presentational. This supersedes the two-cursor Prev/Next pager (#39): the old
// parsePage/totalPages/clampPage/pageHref are gone with it.

export const PAGE_SIZE = 50;

// The two feed tabs. Unread is the default focused view; Read is the demoted
// history (#151). The active tab is URL-addressable as ?tab so it survives a
// reload, the read/unread toggle's returnTo round-trip (#80), and sharing.
export type Tab = 'unread' | 'read';

// Read the active tab from a raw ?tab value, defensively: only the two known
// tabs are honored; anything else (missing, junk, a stray value) falls back to
// the default 'unread' so an unknown param can never break the view.
export function parseTab(raw: string | null): Tab {
	return raw === 'read' ? 'read' : 'unread';
}

// Map a tab to the `read` flag the per-user section queries take
// (listItemsByRead/countItemsByRead): the Read tab is read=true, Unread is
// read=false.
export function isReadTab(tab: Tab): boolean {
	return tab === 'read';
}

// Read a 0-based row offset from a raw query value, defensively: anything that
// isn't a non-negative integer (missing, non-numeric, negative, fractional)
// falls back to 0 — the start of the list. parseInt tolerates trailing junk
// ("50x" -> 50), so we require the trimmed string to be all digits first. The
// /api/feed partial endpoint takes ?offset directly (no page→offset hop), so the
// infinite-scroll cursor is the offset of the next unseen row.
export function parseOffset(raw: string | null): number {
	if (raw === null) return 0;
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return 0;
	return Number.parseInt(trimmed, 10);
}

// Whether more rows remain after a window. Given the section's `total` count and
// the window that was just served (`offset` + how many rows it actually
// returned), there's a next page iff the next offset hasn't reached the total.
// Used to decide whether to render the scroll sentinel / advertise a next-page
// cursor, so an exhausted list never fires a phantom empty fetch (#151).
export function hasMore(offset: number, returned: number, total: number): boolean {
	return offset + returned < total;
}

// The offset the next page starts at, given the current window's offset and how
// many rows it returned. This is the cursor the next /api/feed fetch carries.
export function nextOffset(offset: number, returned: number): number {
	return offset + returned;
}
