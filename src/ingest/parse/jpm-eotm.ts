import type { ParsedItem } from '../types';
import { decodeEntities } from './entities';

// #319 — JPMorgan Asset Management's "Eye on the Market" (Michael Cembalest).
// The landing page (am.jpmorgan.com/.../market-insights/eye-on-the-market/) is a
// client-rendered AEM app with NO RSS/Atom <link rel="alternate"> and NO PDF list
// in its static HTML beyond a handful of curated annual outlooks. The ONGOING
// article stream is rendered client-side from an AEM editorial-landing component
// model: GET <component path>.model.json, which returns a JSON OBJECT whose
// `pages` array holds the listing records, newest first. (Same AEM-JSON shape
// family as the Texas Instruments source #30, but a different container key and
// date encoding, so it gets its own parser rather than reusing parseTiNewsroom.)
//
// Each record carries `title` (display headline), `description` (a one-paragraph
// teaser — the listing has NO full body), a `url` (the per-article HTML page,
// usually a site-relative path like "/us/en/.../eye-on-the-market/home-alone/",
// occasionally already absolute), and `sortDate` — the publish time in epoch
// MILLISECONDS (NOT an RFC-822/ISO string, so parseRfc822 doesn't apply). Some
// entries are webcast/podcast cards (`webcastId` set) but still carry a real
// article `url`, so we keep them like any other.
//
// GOTCHAS (flagged for future maintainers):
//   • LINK-OUT ONLY: contentHtml is always null. The listing gives only the
//     teaser; the full essay lives on the linked article page (and historically
//     as a PDF under /content/dam/jpm-am-aem/…). We keep `description` as the
//     summary and link out via `url`, the same shape as the IR feeds here.
//   • REGION/ROLE GATE: the human-facing page sits behind a country/audience
//     selector and cookie consent, but THIS .model.json endpoint serves the
//     records directly (no cookie needed) — that's why we poll it, not the page.
//   • ENTITY-ENCODED TEXT: the listing strings are HTML fragments the page
//     injects, so titles/teasers can contain `&amp;`/`&#39;`/numeric refs; we
//     decode the plain-text fields (#224) so stored text is clean.

const ORIGIN = 'https://am.jpmorgan.com';

interface EotmRecord {
	title?: string;
	description?: string;
	url?: string;
	sortDate?: number;
}

function textOf(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

// Decode the entity-encoded plain-text fields and trim; an empty result is null.
function cleanText(value: string | null): string | null {
	if (value === null) return null;
	const decoded = decodeEntities(value).trim();
	return decoded === '' ? null : decoded;
}

// Resolve a record `url` to an absolute https URL. The listing usually gives a
// site-relative path ("/us/en/…"); some entries are already absolute. Prefix the
// AM origin for the relative case and pass an absolute one through unchanged.
function resolveUrl(url: string): string {
	return /^https?:\/\//.test(url) ? url : `${ORIGIN}${url}`;
}

// `sortDate` is epoch milliseconds. Convert to unix seconds (the ParsedItem
// contract), or null when it's missing or not a finite number — a non-numeric /
// NaN / Infinity value is untrusted junk and must not become a bad timestamp.
function publishedAtFrom(sortDate: unknown): number | null {
	return typeof sortDate === 'number' && Number.isFinite(sortDate)
		? Math.floor(sortDate / 1000)
		: null;
}

export function parseJpmEotm(json: string): ParsedItem[] {
	// Un-parseable JSON, or a payload that isn't the editorial-landing object with
	// a `pages` array, is the documented rejection — never an undocumented
	// SyntaxError/TypeError on untrusted input (#165). run.ts catches this
	// per-feed and surfaces it as the "not a … feed" anomaly.
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		throw new Error('not a JPM Eye on the Market response: invalid JSON');
	}
	if (typeof parsed !== 'object' || parsed === null) {
		throw new Error('not a JPM Eye on the Market response: expected an object');
	}
	const pages = (parsed as { pages?: unknown }).pages;
	if (!Array.isArray(pages)) {
		throw new Error('not a JPM Eye on the Market response: missing pages array');
	}

	const items: ParsedItem[] = [];
	for (const record of pages) {
		// A null/non-object element (garbage like [null] in pages) has no `url`
		// field; skip it rather than dereferencing it and crashing the parse (#165).
		if (!record || typeof record !== 'object') continue;
		const rec = record as EotmRecord;
		// `url` is the article page and our dedupe key — skip a record without one.
		const rawUrl = textOf(rec.url);
		if (!rawUrl) continue;

		const url = resolveUrl(rawUrl);
		items.push({
			guid: url,
			url,
			title: cleanText(textOf(rec.title)) ?? '',
			summary: cleanText(textOf(rec.description)),
			contentHtml: null,
			publishedAt: publishedAtFrom(rec.sortDate),
		});
	}
	return items;
}
