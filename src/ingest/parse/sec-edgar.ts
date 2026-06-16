import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';

// The SEC EDGAR submissions API — data.sec.gov/submissions/CIK….json — is the
// single, documented data channel we use for company filings. It sits OUTSIDE
// the robots-sensitive /cgi-bin path (so it's the right one to poll), and SEC
// only requires a contact-bearing User-Agent, which run.ts already sends. It
// powers two registry sources today: Texas Instruments' corporate filings (all
// 8-Ks) and Cisco's earnings backstop (Item 2.02 only). #71 consolidated those
// here from two near-duplicate parsers.
//
// The response is JSON, not a feed. `filings.recent` is COLUMNAR: a set of
// parallel arrays (accessionNumber[i], form[i], filingDate[i], items[i], …)
// describing one filing per index, most-recent first. We keep only the 8-K
// "current report" family (the form companies use to disclose material events —
// earnings, leadership changes, etc.) and drop the periodic/ownership noise
// (10-K, 10-Q, Form 4, SC 13G…). A caller may further narrow to specific SEC
// item codes (Cisco's backstop wants Item 2.02, "Results of Operations", only).
//
// guid is the accession number (globally unique, stable); paired with the
// FeedConfig's `source` the (source, guid) dedupe in insertItems collapses
// re-fetches. The feed's own per-filing label is uselessly generic ("8-K -
// Current report"), so we synthesize a readable title from the item codes.
// contentHtml is null — the filing body is a financial document, so we link out.

// data.sec.gov hosts the JSON submissions API; the actual filing documents live
// under www.sec.gov/Archives/edgar.
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';

// Plain-English labels for the common 8-K item codes. An unmapped code
// (rare/new) falls back to "Item N.NN" so the title is still informative.
const ITEM_LABELS: Record<string, string> = {
	'1.01': 'Entry into a Material Definitive Agreement',
	'1.02': 'Termination of a Material Definitive Agreement',
	'2.02': 'Results of Operations and Financial Condition',
	'2.03': 'Creation of a Direct Financial Obligation',
	'2.05': 'Costs Associated with Exit or Disposal Activities',
	'3.03': 'Material Modification to Rights of Security Holders',
	'5.02': 'Departure or Appointment of Directors or Officers',
	'5.03': 'Amendments to Articles of Incorporation or Bylaws',
	'5.07': 'Submission of Matters to a Vote of Security Holders',
	'7.01': 'Regulation FD Disclosure',
	'8.01': 'Other Events',
	'9.01': 'Financial Statements and Exhibits',
};

// Default to the 8-K current-report family (the base form and its amendments).
const DEFAULT_FORMS = ['8-K', '8-K/A'] as const;

// #79 — `filings.recent` is the WHOLE submissions history (the live TI payload
// carries ~1000 rows, ~95 of them 8-Ks back to 2017). Without a cap the FIRST
// poll would backfill years of corporate filings — a far larger, older window
// than any other source. We keep only the N most-recent MATCHING filings; since
// `filings.recent` is most-recent first this is a clean early-exit once N are
// kept (deterministic and time-independent — no Date.now() in the hot path). 20
// mirrors the largest feed window we ingest (the Cloudflare blog's 20-item
// burst) and, at TI's ~1–2 filings/month, still spans ~1 year of history — ample
// headroom so a genuinely new filing is never dropped between polls, while
// bounding the first-poll backfill. Override via SecEdgarOptions.limit.
const DEFAULT_LIMIT = 20;

export interface SecEdgarOptions {
	// CIK as it appears in the Archives path (no leading zeros), e.g. '858877'.
	// Used to build per-filing document URLs.
	cik: string;
	// Issuer name to prefix synthesized titles with, e.g. 'Texas Instruments'.
	issuer: string;
	// Filing forms to keep. Defaults to the 8-K current-report family.
	forms?: readonly string[];
	// Optional SEC item-code filter: keep only filings whose reported items
	// include at least one of these codes. Cisco's backstop passes ['2.02'] to
	// keep just the earnings 8-Ks; omit it (TI) to keep every matching form.
	items?: readonly string[];
	// Recent-window cap (#79): keep at most this many of the most-recent matching
	// filings, so the first poll never backfills the whole filings.recent history.
	// Defaults to DEFAULT_LIMIT (20). Pass 0 or a negative value to keep none.
	limit?: number;
}

interface EdgarRecent {
	accessionNumber?: string[];
	filingDate?: string[];
	acceptanceDateTime?: string[];
	form?: string[];
	items?: string[];
	primaryDocument?: string[];
}

interface EdgarSubmissions {
	filings?: { recent?: EdgarRecent };
}

function textOf(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

// Split a comma-joined item string ("2.02,9.01") into trimmed, non-empty codes.
function itemCodes(items: string | null): string[] {
	if (!items) return [];
	return items
		.split(',')
		.map((code) => code.trim())
		.filter((code) => code !== '');
}

// "2.02,9.01" → "Results of Operations and Financial Condition;
// Financial Statements and Exhibits". An empty/codeless list yields null so the
// title can omit the dash.
function describeItems(codes: string[]): string | null {
	if (codes.length === 0) return null;
	return codes.map((code) => ITEM_LABELS[code] ?? `Item ${code}`).join('; ');
}

export function parseSecEdgar(json: string, options: SecEdgarOptions): ParsedItem[] {
	const { cik, issuer } = options;
	const forms = options.forms ?? DEFAULT_FORMS;
	const itemFilter = options.items;
	const limit = options.limit ?? DEFAULT_LIMIT;

	const parsed = JSON.parse(json) as EdgarSubmissions;
	const recent = parsed.filings?.recent;
	if (!recent || !Array.isArray(recent.accessionNumber)) {
		throw new Error('not an EDGAR submissions response: missing filings.recent');
	}

	// One pass over the columnar arrays, deciding keep/drop per filing as plain
	// field access. The recent-window cap (#79) is enforced here: `filings.recent`
	// is most-recent first, so once we've kept `limit` matching filings every
	// remaining row is strictly older and can be skipped — a clean early exit that
	// bounds the first-poll backfill without scanning the whole history.
	const items: ParsedItem[] = [];
	for (let i = 0; i < recent.accessionNumber.length; i++) {
		if (items.length >= limit) break;

		const form = textOf(recent.form?.[i]);
		// Keep only the configured filing forms (default: 8-K / 8-K/A).
		if (!form || !forms.includes(form)) continue;

		// No accession number means nothing stable to dedupe on — skip it.
		const accession = textOf(recent.accessionNumber[i]);
		if (!accession) continue;

		const codes = itemCodes(textOf(recent.items?.[i]));
		// Optional item-code filter: when set, keep only filings reporting at least
		// one of the requested SEC items (Cisco backstop: Item 2.02 earnings only).
		if (itemFilter && !codes.some((code) => itemFilter.includes(code))) continue;

		// The filing's documents live at .../edgar/data/<cik>/<accession no dashes>/.
		const folder = accession.replace(/-/g, '');
		const primaryDocument = textOf(recent.primaryDocument?.[i]);
		const url = primaryDocument
			? `${ARCHIVES_BASE}/${cik}/${folder}/${primaryDocument}`
			: `${ARCHIVES_BASE}/${cik}/${folder}/`;

		const description = describeItems(codes);
		const title = description ? `${issuer} ${form} — ${description}` : `${issuer} ${form}`;

		// acceptanceDateTime is the precise ISO-8601 timestamp; fall back to the
		// (date-only) filingDate. Date.parse handles both (see parse/dates.ts).
		const published = textOf(recent.acceptanceDateTime?.[i]) ?? textOf(recent.filingDate?.[i]);

		items.push({
			guid: accession,
			url,
			title,
			summary: description,
			contentHtml: null,
			publishedAt: parseRfc822(published),
		});
	}
	return items;
}
