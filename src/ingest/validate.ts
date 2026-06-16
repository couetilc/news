import type { ParsedItem } from './types';

// Shape-drift detection (#78). Our parser tests assert that the CURRENT feed
// shapes parse; nothing catches when a live source's structure changes under us
// (a renamed/removed field, a format switch, an empty/garbage payload). A
// silently-broken parser would ingest nothing — or wrong data — until noticed by
// hand. This module turns one poll's outcome into a structured anomaly signal so
// drift is visible in Workers Logs (the `ingest.anomaly` event) before the feed
// goes stale.
//
// It is a PURE function over the poll result — no I/O, no logging, no DB — so the
// caller (run.ts) decides what to do with the verdict and per-feed isolation is
// never at risk. run.ts emits the returned anomaly via the structured-log helper.

// The three distinguishable verdicts (see the issue's acceptance criteria). The
// `kind` is the queryable axis in Workers Logs (filter `event = ingest.anomaly`,
// then by `kind`):
//   - 'zero_parsed_of_raw' — the SMOKING GUN: a 200 whose payload carried raw
//     entries, but the parser produced ZERO items. Almost always a shape change
//     (the parser no longer recognises the entries). Distinct from a feed that
//     was simply empty this poll — that yields no anomaly at all.
//   - 'parse_drop' — the parser yielded SOME items but dropped a large fraction
//     of the raw entries (>= DROP_FRACTION). A softer drift signal: a renamed
//     field that only some entries use, or a partial format switch.
//   - 'missing_required_fields' — at least one parsed item is missing a required
//     field (empty guid/url/title) or carries an implausible date. The parser
//     "succeeded" but produced junk — the other face of shape drift.
export type AnomalyKind = 'zero_parsed_of_raw' | 'parse_drop' | 'missing_required_fields';

export interface Anomaly {
	kind: AnomalyKind;
	// How many raw entries the payload carried (when the feed supplies a raw
	// counter), and how many survived parsing. Both are logged so the drop is
	// quantified, not just flagged.
	rawCount: number | null;
	parsedCount: number;
	// Present on 'missing_required_fields': which fields were bad, and on how many
	// items, so the log says WHAT drifted without dumping article bodies.
	missingFields?: string[];
	invalidCount?: number;
}

// Flag a parse that kept SOME items but dropped at least this fraction of the
// raw entries. 0.5 — losing half or more of a non-empty payload is a strong
// drift signal while tolerating the ordinary churn of a parser that skips the
// odd malformed entry (one bad item out of ten is not an anomaly).
export const DROP_FRACTION = 0.5;

// A publishedAt is optional (parsers legitimately emit null when a feed omits a
// date), so null is NOT an anomaly. We only flag a NON-null timestamp that is
// implausible: before the unix epoch, or absurdly far in the future. The future
// bound is generous (a feed's clock skew or a scheduled-post date shouldn't trip
// it) — this catches a unit mix-up (ms instead of seconds reads as the year
// ~50,000+) or garbage, not ordinary dates.
const MAX_PLAUSIBLE_PUBLISHED_AT = 4_102_444_800; // 2100-01-01T00:00:00Z, unix seconds.

function isPlausibleDate(publishedAt: number | null): boolean {
	if (publishedAt === null) return true;
	return Number.isFinite(publishedAt) && publishedAt >= 0 && publishedAt <= MAX_PLAUSIBLE_PUBLISHED_AT;
}

// A single item's required-field violations. guid/url/title are the columns the
// reader and dedupe rely on; an empty one means the parser pulled from the wrong
// place. Date is checked for plausibility (null is fine; see above).
function fieldViolations(item: ParsedItem): string[] {
	const bad: string[] = [];
	if (item.guid === '') bad.push('guid');
	if (item.url === '') bad.push('url');
	if (item.title === '') bad.push('title');
	if (!isPlausibleDate(item.publishedAt)) bad.push('publishedAt');
	return bad;
}

export interface ValidateInput {
	// Raw entries the payload carried, when the feed supplies a `countRaw` (see
	// FeedConfig). null when the feed doesn't — then the zero/drop checks (which
	// need a denominator) are skipped and only field validation runs.
	rawCount: number | null;
	items: ParsedItem[];
}

// Inspect one successful (200) poll's parse result and return an Anomaly when it
// looks like shape drift, or null when the poll is healthy — INCLUDING the
// legitimately-empty case (raw 0, parsed 0), which is normal and must not alarm.
//
// Order matters: a non-empty payload that parsed to NOTHING is the strongest,
// least-ambiguous drift signal, so it wins over the per-item field checks (with 0
// items there are none to check anyway). A partial drop is reported next. Only a
// parse that produced items AND counts is then checked for bad fields.
export function validateParse({ rawCount, items }: ValidateInput): Anomaly | null {
	const parsedCount = items.length;

	// Zero/drop checks need a raw denominator. Skip them when the feed has no
	// counter, or when the payload was genuinely empty (rawCount 0 → nothing to
	// parse, so parsing nothing is correct, not drift).
	if (rawCount !== null && rawCount > 0) {
		if (parsedCount === 0) {
			return { kind: 'zero_parsed_of_raw', rawCount, parsedCount };
		}
		if (parsedCount < rawCount * DROP_FRACTION) {
			return { kind: 'parse_drop', rawCount, parsedCount };
		}
	}

	// Per-item required-field validation. Collect the distinct bad field names and
	// a count of offending items so the log names WHAT drifted and HOW WIDELY.
	const missing = new Set<string>();
	let invalidCount = 0;
	for (const item of items) {
		const bad = fieldViolations(item);
		if (bad.length > 0) {
			invalidCount++;
			for (const f of bad) missing.add(f);
		}
	}
	if (invalidCount > 0) {
		return {
			kind: 'missing_required_fields',
			rawCount,
			parsedCount,
			missingFields: [...missing].sort(),
			invalidCount,
		};
	}

	return null;
}
