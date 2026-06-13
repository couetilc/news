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
}
