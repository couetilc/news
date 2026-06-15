import { XMLParser } from 'fast-xml-parser';
import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';

// SEC EDGAR's browse-edgar Atom feed for a company's filings (#31, the Cisco
// earnings backstop). It is an Atom feed, but it does NOT fit parseAtom: every
// <entry> shares a generic <title>8-K - Current report</title>, and the useful
// metadata (accession number, filing date, the SEC "item" codes) lives in a
// NESTED <content type="text/xml"> block, not in plain HTML. We also only want
// the earnings 8-Ks — a company files many 8-Ks (director changes, bylaw
// amendments, …); the earnings release is the one carrying SEC Item 2.02,
// "Results of Operations and Financial Condition". So this is a dedicated
// parser closure that reads the nested fields and filters to Item 2.02.
//
// The accession number is the stable dedupe guid: EDGAR never reissues one, and
// re-polling the feed returns the same accession, so insertItems' (source, guid)
// ON CONFLICT collapses repeat polls to a single row. (The IR press-release feed
// uses its own UUID guids, so the same earnings event surfaces as two rows — one
// per artifact, the PR and the SEC filing — which is intended.)

// fast-xml-parser config: keep attributes (we need <link href> and the <updated>
// text alongside other element text), name the text node, and force <entry> to
// always be an array so a single-filing feed still iterates uniformly.
const TEXT = '#text';
const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	textNodeName: TEXT,
	parseTagValue: false,
	isArray: (_name, jpath) => jpath === 'feed.entry',
});

function textOf(node: unknown): string | null {
	let t: unknown = node;
	if (node && typeof node === 'object' && TEXT in node) {
		t = (node as Record<string, unknown>)[TEXT];
	}
	return typeof t === 'string' && t !== '' ? t : null;
}

// SEC item codes appear in <items-desc> in free-form prose, e.g.
// "items 2.02, 2.05and9.01" or "items 2.02 and 9.01" or "item 5.02" — spacing
// is inconsistent. Match 2.02 only when it isn't part of a longer number
// (so 2.02 matches but a hypothetical 2.020/12.02 would not).
const ITEM_2_02 = /(?<!\d)2\.02(?!\d)/;

interface EdgarContent {
	'accession-number'?: unknown;
	'filing-date'?: unknown;
	'filing-href'?: unknown;
	'filing-type'?: unknown;
	'items-desc'?: unknown;
}

interface EdgarEntry {
	content?: EdgarContent;
	id?: unknown;
	link?: { '@_href'?: string } | { '@_href'?: string }[];
	summary?: unknown;
	updated?: unknown;
}

// An entry may carry several <link>s; take the first href. browse-edgar emits a
// single rel="alternate" link per entry, but normalize to an array defensively.
function linkHref(link: EdgarEntry['link']): string | null {
	const links = link === undefined ? [] : Array.isArray(link) ? link : [link];
	for (const l of links) {
		if (typeof l['@_href'] === 'string' && l['@_href'] !== '') return l['@_href'];
	}
	return null;
}

export function parseEdgar8k(xml: string): ParsedItem[] {
	const feed = parser.parse(xml).feed;
	if (!feed) {
		throw new Error('not an EDGAR Atom feed: missing feed root');
	}

	const items: ParsedItem[] = [];
	for (const entry of (feed.entry ?? []) as EdgarEntry[]) {
		const content = entry.content ?? {};
		const itemsDesc = textOf(content['items-desc']);
		// Backstop scope is earnings only: keep just the 8-Ks reporting results of
		// operations (Item 2.02); skip every other 8-K in the feed.
		if (!itemsDesc || !ITEM_2_02.test(itemsDesc)) continue;

		// The accession number is the stable cross-poll dedupe key; without it
		// there's nothing safe to dedupe on, so skip the entry.
		const accession = textOf(content['accession-number']);
		if (!accession) continue;

		const filingDate = textOf(content['filing-date']);
		// <updated> carries the precise filing timestamp (down to the second, with
		// offset); fall back to the date-only <filing-date> if it's ever missing.
		const published = textOf(entry.updated) ?? filingDate;
		const url = linkHref(entry.link) ?? textOf(content['filing-href']);

		// Build a human title: the feed's own <title> is the useless generic
		// "8-K - Current report", so synthesize one that names the filing and date.
		const filingType = textOf(content['filing-type']) ?? '8-K';
		const title = filingDate
			? `Cisco ${filingType}: Results of Operations and Financial Condition (Item 2.02) — filed ${filingDate}`
			: `Cisco ${filingType}: Results of Operations and Financial Condition (Item 2.02)`;

		items.push({
			guid: accession,
			url: url ?? accession,
			title,
			// The EDGAR <summary> is a short HTML blurb listing the filing's items;
			// keep it as the summary (it's a teaser, not the filing body).
			summary: textOf(entry.summary),
			contentHtml: null,
			publishedAt: parseRfc822(published),
		});
	}
	return items;
}
