// Pagination math for the homepage's two independent section cursors (#39).
// Kept out of the .astro templates so the branchy parsing/clamping logic is
// unit-tested directly and the components stay presentational. OFFSET paging at
// 50/page; each section (unread, read) carries its own ?page param so paging one
// never moves the other.

export const PAGE_SIZE = 50;

// Read a 1-based page number from a raw query value, defensively: anything that
// isn't a positive integer (missing, non-numeric, zero, negative, fractional)
// falls back to page 1. parseInt tolerates trailing junk ("2x" -> 2), so we
// require the trimmed string to be all digits first.
export function parsePage(raw: string | null): number {
	if (raw === null) return 1;
	const trimmed = raw.trim();
	if (!/^\d+$/.test(trimmed)) return 1;
	const n = Number.parseInt(trimmed, 10);
	return n >= 1 ? n : 1;
}

// Total pages for a section of `total` items at PAGE_SIZE each. An empty section
// is still one (empty) page so the page number never reads as "0 of 0".
export function totalPages(total: number): number {
	return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

// Clamp a requested page into [1, totalPages]. Paging past the last page lands
// on the last page rather than 500-ing or showing a phantom empty page beyond
// the data.
export function clampPage(page: number, total: number): number {
	const last = totalPages(total);
	if (page > last) return last;
	return page;
}

// Row offset for a (clamped) page: (page-1)*PAGE_SIZE.
export function offsetFor(page: number): number {
	return (page - 1) * PAGE_SIZE;
}

// Build the href for a section page, preserving the active source filter and the
// *other* section's page param, and writing this section's page param. page 1 is
// the default, so it's omitted to keep URLs clean (and so a chip's "reset to 1"
// just drops the param). `extra` carries the sibling section's param when it's
// past page 1; pass null to omit it.
export function pageHref(
	sources: string[],
	param: string,
	page: number,
	extra: { param: string; page: number } | null,
): string {
	const params = new URLSearchParams();
	for (const s of sources) params.append('source', s);
	if (extra && extra.page > 1) params.set(extra.param, String(extra.page));
	if (page > 1) params.set(param, String(page));
	const qs = params.toString();
	return qs ? `/?${qs}` : '/';
}
