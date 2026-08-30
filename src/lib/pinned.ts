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
	// Whether the origin blocks all automated feed paths (a bot-challenge wall a
	// Worker can't solve), so the site can only be *linked to*, never ingested.
	// The strip shows a small "scrape-protected" tag so the reader knows why this
	// source lives here instead of in the feed (#330). Modeled as an optional flag
	// on the same entry — like `pdf` — rather than a parallel array or separate
	// section, so PinnedLinks.astro stays one list with per-entry tags.
	scrapeProtected?: boolean;
}

// The registry:
//
// - (#316) JP Morgan's *Trump Policy Impact Tracker* PDF — a standalone,
//   always-present reference from the *Eye on the Market* series. The
//   `?secureweb=Teams` Teams-share artifact has been stripped from the canonical
//   URL. (The ongoing *Eye on the Market* article stream is a normal feed
//   source, tracked separately as #319 — this is only the single pinned PDF.)
// - (#330) Citadel Securities *Market Insights* — a scrape-protected reference
//   link, NOT an ingested feed source. The feed attempt (#318) is dead: the
//   entire citadelsecurities.com origin sits behind a Cloudflare managed JS
//   challenge a Worker cannot solve (every feed path 403s with
//   `cf-mitigated: challenge`; OpenRSS proxies come back empty; render-proxies
//   were rejected as a new dependency class). Linking out is the whole feature.
export const PINNED: PinnedLink[] = [
	{
		label: 'Trump Policy Impact Tracker',
		href: 'https://assets.jpmprivatebank.com/content/dam/jpm-pb-aem/global/en/documents/eotm/trump-tracker.pdf',
		pdf: true,
	},
	{
		label: 'Citadel Securities Market Insights',
		href: 'https://www.citadelsecurities.com/news-and-insights/category/market-insights/',
		scrapeProtected: true,
	},
];
