import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';

// #30 — Texas Instruments' newsroom News Releases and Company Blog pages render
// their lists client-side from one AEM endpoint: GET /bin/ti/newsroom?page=N&
// lang=en-us&categories=none&years=none&type=<news|blog>. (The page's
// newsFilterGoup/blogFilterGoup clientlibs call exactly this; there is no
// RSS/Atom <link rel="alternate"> on either page.) It returns JSON, not a feed.
//
// The response is an ARRAY: element 0 is the total-results count (a string), and
// elements 1..N are the listing records, most-recent first. Each record carries
// `headline` (display title; `name` is the same text but with literal HTML
// entities, used as a fallback), `subheadline` (a one-line teaser), an absolute
// `path` (the article URL — our stable guid), `image`, `category`, and a
// `date` formatted "DD Mon YYYY" (e.g. "09 Jun 2026").
//
// `news` mode carries product/technology announcements + investor PRs; `blog`
// mode carries the company blog — same record shape, so one parser serves both.
// contentHtml is null: the listing gives only a teaser, so we keep `subheadline`
// as the summary and link out to `path` for the full article. The teaser/title
// text may contain HTML entities (`&amp;`, `&apos;`, numeric refs) because the
// page injects it as HTML; we decode the common ones so stored text is clean.

interface TiNewsRecord {
	name?: string;
	headline?: string;
	subheadline?: string;
	path?: string;
	date?: string;
	category?: string;
}

function textOf(value: unknown): string | null {
	return typeof value === 'string' && value !== '' ? value : null;
}

// The listing strings are HTML fragments (the page injects them with innerHTML),
// so decode the handful of entities TI actually emits into plain text. Numeric
// refs (&#39;, &#x27;) cover anything not in the named map.
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

function decodeEntities(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
		if (body[0] === '#') {
			// The regex requires ≥1 digit and admits a lowercase `x` only for hex
			// (`&#xNN;`); a bare `&#NN;` is decimal — so parseInt always succeeds.
			const code =
				body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			return String.fromCodePoint(code);
		}
		const named = NAMED_ENTITIES[body.toLowerCase()];
		return named ?? match;
	});
}

function cleanText(value: string | null): string | null {
	if (value === null) return null;
	const decoded = decodeEntities(value).trim();
	return decoded === '' ? null : decoded;
}

export function parseTiNewsroom(json: string): ParsedItem[] {
	const parsed = JSON.parse(json) as unknown;
	if (!Array.isArray(parsed)) {
		throw new Error('not a TI newsroom response: expected an array');
	}

	const items: ParsedItem[] = [];
	// Element 0 is the total-count string; the records start at index 1.
	for (const record of parsed.slice(1) as TiNewsRecord[]) {
		// `path` is the article URL and our dedupe key — skip a record without one.
		const path = textOf(record.path);
		if (!path) continue;

		const title = cleanText(textOf(record.headline) ?? textOf(record.name)) ?? '';
		items.push({
			guid: path,
			url: path,
			title,
			summary: cleanText(textOf(record.subheadline)),
			contentHtml: null,
			publishedAt: parseRfc822(textOf(record.date)),
		});
	}
	return items;
}
