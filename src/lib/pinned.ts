// Pinned links: a small, owner-curated list of always-present reference
// documents shown in a strip at the top of the homepage (#316), above the source
// FilterBar. Unlike feed items, these don't flow through ingest, carry no
// source slug / read state, and never scroll away — they're a distinct "lane".
//
// Modeled as a tiny typed array (mirroring the small-typed-array precedent of
// src/ingest/sources.ts) so adding a second pinned link later is trivial: append
// an entry here, no component change needed. It is NOT (yet) a full curated-
// references feature — just the data shape one would grow into.

export interface PinnedLink {
	// The display label shown in the strip (agate small-caps voice on render).
	label: string;
	// The destination. External links open in a new tab with a safe rel (see
	// PinnedLinks.astro); a PDF target is flagged via `pdf` so the UI can mark it.
	href: string;
	// Whether the target is a PDF, so the strip can show a small "PDF" affordance.
	pdf?: boolean;
}

// One entry today (#316): JP Morgan's *Trump Policy Impact Tracker* PDF — a
// standalone, always-present reference from the *Eye on the Market* series. The
// `?secureweb=Teams` Teams-share artifact has been stripped from the canonical
// URL. (The ongoing *Eye on the Market* article stream is a normal feed source,
// tracked separately as #319 — this is only the single pinned PDF.)
export const PINNED: PinnedLink[] = [
	{
		label: 'Trump Policy Impact Tracker',
		href: 'https://assets.jpmprivatebank.com/content/dam/jpm-pb-aem/global/en/documents/eotm/trump-tracker.pdf',
		pdf: true,
	},
];
