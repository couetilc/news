import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';

// #30 — Texas Instruments has no working public news/IR feed (the Q4 IR `.aspx`
// RSS that Cisco/Qualcomm use is 404 on TI's platform, the old Mediaroom
// pressroom is gone, and the ti.com newsroom renders its list from a private
// API with no RSS/Atom link). The one reliable, officially-supported channel is
// the SEC: data.sec.gov/submissions/CIK0000097476.json — the EDGAR submissions
// API (NOT under /cgi-bin, so unaffected by sec.gov's robots disallow; a
// contact-bearing User-Agent is required, which run.ts already sends).
//
// It returns JSON, not a feed. `filings.recent` is COLUMNAR: a set of parallel
// arrays (accessionNumber[i], form[i], filingDate[i], items[i], …) describing
// one filing per index, most-recent first. We keep only 8-K / 8-K/A "current
// report" filings — the form companies use to disclose material events
// (earnings, leadership changes, etc.) — and drop the periodic/ownership noise
// (10-K, 10-Q, 4, SC 13G…). Caveat: 8-Ks are material/financial events, not
// product launches, so this surfaces TI's corporate news, not new-chip blurbs.
//
// guid is the accession number (globally unique, stable); with source 'ti' the
// (source, guid) dedupe in insertItems collapses re-fetches. The feed's own
// per-filing label is uselessly generic ("8-K - Current report"), so we
// synthesize a readable title from the 8-K item codes. contentHtml is null — the
// filing body is a financial document, so we link out to it on EDGAR.

// data.sec.gov hosts the JSON submissions API; the actual filing documents live
// under www.sec.gov/Archives/edgar.
const ARCHIVES_BASE = 'https://www.sec.gov/Archives/edgar/data';

// Plain-English labels for the 8-K item codes TI actually files. An unmapped
// code (rare/new) falls back to "Item N.NN" so the title is still informative.
const ITEM_LABELS: Record<string, string> = {
	'1.01': 'Entry into a Material Definitive Agreement',
	'1.02': 'Termination of a Material Definitive Agreement',
	'2.02': 'Results of Operations and Financial Condition',
	'2.03': 'Creation of a Direct Financial Obligation',
	'3.03': 'Material Modification to Rights of Security Holders',
	'5.02': 'Departure or Appointment of Directors or Officers',
	'5.03': 'Amendments to Articles of Incorporation or Bylaws',
	'5.07': 'Submission of Matters to a Vote of Security Holders',
	'7.01': 'Regulation FD Disclosure',
	'8.01': 'Other Events',
	'9.01': 'Financial Statements and Exhibits',
};

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

// "2.02,9.01" → "Results of Operations and Financial Condition,
// Financial Statements and Exhibits". An empty/missing list yields null so the
// title can omit the dash.
function describeItems(items: string | null): string | null {
	if (!items) return null;
	const labels = items
		.split(',')
		.map((code) => code.trim())
		.filter((code) => code !== '')
		.map((code) => ITEM_LABELS[code] ?? `Item ${code}`);
	return labels.length > 0 ? labels.join('; ') : null;
}

export function parseSecEdgar(json: string): ParsedItem[] {
	const parsed = JSON.parse(json) as EdgarSubmissions;
	const recent = parsed.filings?.recent;
	if (!recent || !Array.isArray(recent.accessionNumber)) {
		throw new Error('not an EDGAR submissions response: missing filings.recent');
	}

	const items: ParsedItem[] = [];
	for (let i = 0; i < recent.accessionNumber.length; i++) {
		const form = textOf(recent.form?.[i]);
		// Keep only current reports (8-K and its 8-K/A amendments).
		if (form !== '8-K' && form !== '8-K/A') continue;

		// No accession number means nothing stable to dedupe on — skip it.
		const accession = textOf(recent.accessionNumber[i]);
		if (!accession) continue;

		// The filing's documents live at .../edgar/data/<cik>/<accession no dashes>/.
		const folder = accession.replace(/-/g, '');
		const primaryDocument = textOf(recent.primaryDocument?.[i]);
		const url = primaryDocument
			? `${ARCHIVES_BASE}/97476/${folder}/${primaryDocument}`
			: `${ARCHIVES_BASE}/97476/${folder}/`;

		const description = describeItems(textOf(recent.items?.[i]));
		const title = description
			? `Texas Instruments ${form} — ${description}`
			: `Texas Instruments ${form}`;

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
