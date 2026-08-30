// A feed entry normalized into the shape the `items` table stores. Dates are
// unix seconds UTC (or null when the feed omits one); guid is whatever stable
// id the feed provides, used with `source` to deduplicate.
export interface ParsedItem {
	guid: string;
	url: string;
	title: string;
	summary: string | null;
	contentHtml: string | null;
	publishedAt: number | null;
}

// A pollable endpoint. `feed` (the URL) is the primary key of the `feeds` state
// table; several FeedConfigs may share one `source`. `parse` is a closure so
// each source supplies its own parser/options — the override seam for future
// quirks (Atom, NVIDIA's bare <content>, JSON APIs).
export interface FeedConfig {
	source: string;
	feed: string;
	pollIntervalSeconds: number;
	parse(xml: string): ParsedItem[];
	// Shape-drift detection (#78): count the RAW entries in a payload, independent
	// of how many `parse` keeps. run.ts compares the two to spot a 200 that carried
	// entries but parsed to zero (a renamed/removed field), distinguishing it from
	// a feed that was simply empty. Each source declares how to count its own
	// container (RSS <item>, Atom <entry>, JSON array, …) — the same per-source
	// seam as `parse`. Optional: a feed without it still gets per-item field
	// validation, just not the zero-of-N signal. A counter must never throw on a
	// payload `parse` would reject — `parse` runs first and surfaces that error.
	countRaw?(payload: string): number;
	// Editorial filter (#321): return false to drop a successfully parsed item as
	// noise (e.g. AWS "… now available in <region>" rollout announcements). run.ts
	// applies it AFTER the shape-drift check (reportAnomaly) and BEFORE
	// insertItems — NOT inside `parse` — so a feed that is legitimately mostly
	// noise never trips the parse_drop / zero_parsed_of_raw anomalies, `parse`
	// stays a pure shape concern, and the drop is logged (`filtered` on
	// ingest.poll) rather than silent. Optional: a feed without it keeps
	// everything it parses.
	keep?(item: ParsedItem): boolean;
}
