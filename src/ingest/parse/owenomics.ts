import type { ParsedItem } from '../types';
import { decodeEntities } from './entities';

// Owenomics cards retain the old Results shape after fetchOwenomics assembles
// Acadian's public Sitecore Cloud search and canonical URL lookup responses.
// Date is deliberately Month YYYY: the website still displays monthly dates,
// and keeping that precision preserves existing ordering. Locale copies share
// canonical URLs and subscribe remains a form, not an article.

const ORIGIN = 'https://www.acadian-asset.com';

interface OwenomicsRecord {
	Title?: string;
	Url?: string;
	Date?: string;
}

// English month names → 0-based month index, for the listing's "Month YYYY"
// date strings. A fixed table keeps the parse deterministic and timezone-proof
// (no reliance on Date.parse's nonstandard month-year handling).
const MONTHS: Record<string, number> = {
	january: 0,
	february: 1,
	march: 2,
	april: 3,
	may: 4,
	june: 5,
	july: 6,
	august: 7,
	september: 8,
	october: 9,
	november: 10,
	december: 11,
};

function textOf(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

// Decode entity-encoded text and trim; an empty result is null. Titles are
// plain text in the JSON today, but Sitecore listing strings are injected as
// HTML fragments, so decode defensively like the sibling parsers (#224).
function cleanText(value: string | null): string | null {
	if (value === null) return null;
	const decoded = decodeEntities(value).trim();
	return decoded === '' ? null : decoded;
}

// "August 2026" → unix seconds at the first of that month, 00:00 UTC — the
// finest machine-readable date the listing offers (see the header). Anything
// that isn't a recognizable "Month YYYY" is untrusted junk → null.
function parseMonthYear(value: string | null): number | null {
	if (value === null) return null;
	const match = /^\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(value);
	if (!match) return null;
	const month = MONTHS[match[1].toLowerCase()];
	if (month === undefined) return null;
	return Math.floor(Date.UTC(Number(match[2]), month, 1) / 1000);
}

// Resolve a record Url to the CANONICAL absolute article URL: prefix the origin
// for the usual site-relative path (pass an already-absolute one through), then
// collapse the /au/ locale prefix onto the non-regional path so the AU
// duplicates of the same article normalize to one URL (the dedupe key).
function normalizeUrl(rawUrl: string): string {
	const absolute = /^https?:\/\//.test(rawUrl) ? rawUrl : `${ORIGIN}${rawUrl}`;
	// The origin-prefixed pattern can only match at position 0, so this is a
	// pure prefix strip.
	return absolute.replace(`${ORIGIN}/au/`, `${ORIGIN}/`);
}

export function parseOwenomics(json: string): ParsedItem[] {
	// Un-parseable JSON, or a payload that isn't the results object with a
	// `Results` array, is the documented rejection — never an undocumented
	// SyntaxError/TypeError on untrusted input (#165). run.ts catches this
	// per-feed and surfaces it as the "not a … response" anomaly.
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error('not an Owenomics listing response: invalid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('not an Owenomics listing response: expected an object');
	}
	const results = (parsed as { Results?: unknown }).Results;
	if (!Array.isArray(results)) {
		throw new Error('not an Owenomics listing response: missing Results array');
	}

	const items: ParsedItem[] = [];
	const seen = new Set<string>();
	for (const record of results) {
		// A null/non-object element (garbage like [null] in Results) has no `Url`
		// field; skip it rather than dereferencing it and crashing the parse (#165).
		if (!record || typeof record !== 'object') continue;
		const rec = record as OwenomicsRecord;
		// `Url` is the article page and our dedupe key — skip a record without one.
		const rawUrl = textOf(rec.Url);
		if (!rawUrl) continue;

		const url = normalizeUrl(rawUrl);
		// The subscribe email form is a page link, not an article — excluded.
		if (url.endsWith('/subscribe')) continue;
		// Locale duplicates (/au/…) normalize to the same URL — keep the first.
		if (seen.has(url)) continue;
		seen.add(url);

		items.push({
			guid: url,
			url,
			title: cleanText(textOf(rec.Title)) ?? '',
			summary: null,
			contentHtml: null,
			publishedAt: parseMonthYear(textOf(rec.Date)),
		});
	}
	return items;
}
