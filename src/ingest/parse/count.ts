import { XMLParser } from 'fast-xml-parser';

// Raw-entry counters for shape-drift detection (#78). Each mirrors the container
// its sibling parser iterates over (RSS `rss.channel.item`, Atom `feed.entry`,
// the JSON arrays) and returns HOW MANY raw entries the payload carried, before
// any per-entry keep/drop logic. run.ts compares this with how many `parse` kept:
// raw > 0 but parsed 0 is the smoking-gun "the parser stopped recognising the
// entries" signal (see validate.ts).
//
// These count only — they never throw on a payload the parser would reject (the
// parser runs first in run.ts and surfaces that error). A malformed/garbage
// payload simply counts as 0 raw entries here, which is the correct denominator:
// "0 raw, 0 parsed" is not flagged as drift, the parse error already is.

// A counting XMLParser: same array coercion as the real parsers so a single
// <item>/<entry> still counts as one, but we discard everything else.
const xml = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	isArray: (_name, jpath) => jpath === 'rss.channel.item' || jpath === 'feed.entry',
});

function arrayLength(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

// RSS 2.0: the <item> elements under <channel>. A payload that no longer has
// rss > channel (a format switch) counts as 0 — and `parse` will already have
// thrown on it, so run.ts never reaches the counter in that case.
export function countRss20(payload: string): number {
	const parsed = xml.parse(payload) as { rss?: { channel?: { item?: unknown } } };
	return arrayLength(parsed.rss?.channel?.item);
}

// Atom: the <entry> elements under <feed>.
export function countAtom(payload: string): number {
	const parsed = xml.parse(payload) as { feed?: { entry?: unknown } };
	return arrayLength(parsed.feed?.entry);
}

// AWS What's New search API: the top-level `items` array (each element wraps one
// record under `item`).
export function countAwsWhatsNew(payload: string): number {
	const parsed = JSON.parse(payload) as { items?: unknown };
	return arrayLength(parsed.items);
}

// TI newsroom AEM endpoint: the response is an array whose element 0 is the
// total-count string and elements 1..N are the records — so the raw entry count
// is length minus the count header (never negative).
export function countTiNewsroom(payload: string): number {
	const parsed = JSON.parse(payload) as unknown;
	return Array.isArray(parsed) ? Math.max(parsed.length - 1, 0) : 0;
}

// NOTE: SEC EDGAR deliberately has NO raw counter. `filings.recent` is the whole
// columnar filings history (~1000 rows for TI), but parseSecEdgar keeps only the
// configured 8-K forms within a 20-item recent window — so the columnar height
// over-counts what parse keeps by ~50×, and a raw-vs-parsed comparison would trip
// the drop/zero signal on every healthy poll. A window that legitimately holds no
// 8-Ks is also normal there. EDGAR feeds therefore rely on per-item field
// validation only (no `countRaw`), which is the honest signal for that shape.
