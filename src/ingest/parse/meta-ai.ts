import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';
import { decodeEntities } from './entities';

const ORIGIN = 'https://research.meta.ai';
const ARTICLE_ORIGINS = new Set([ORIGIN, 'https://ai.meta.com']);
const CARD = /\sdata-blog-post-summary=["'](?:featured|card)["']/i;

function titleText(body: string): string {
	const open = /<h2\b[^<>]*>/i.exec(body);
	if (!open) return '';
	const tail = body.slice(open.index + open[0].length);
	const end = /<\/h2\s*>/i.exec(tail)?.index ?? 0;
	return decodeEntities(tail.slice(0, end).replace(/<[^<>]*>/g, ''))
		.replace(/\s+/g, ' ').trim();
}

// Meta's current research listing is server-rendered HTML with semantic card
// attributes. Its generated CSS names change between builds; do not match them.
// Headlines link out to the original article, and dateTime is midnight UTC.
function parseCard(body: string): ParsedItem | null {
	const href = /<a\b[^<>]*\shref=["']([^"']*)["']/i.exec(body)?.[1];
	if (!href) return null;
	let url: URL;
	try {
		url = new URL(decodeEntities(href), ORIGIN);
	} catch {
		return null;
	}
	// Older cards still link to ai.meta.com. Keep both first-party origins;
	// discard nav, external links and non-web schemes. Remove tracking/fragment
	// variants from the dedupe key.
	if (!ARTICLE_ORIGINS.has(url.origin) || !/^\/blog\/[a-z0-9-]+\/?$/i.test(url.pathname)) return null;
	url.search = '';
	url.hash = '';
	url.pathname = url.pathname.replace(/\/$/, '');
	return {
		guid: url.href,
		url: url.href,
		title: titleText(body),
		summary: null,
		contentHtml: null,
		publishedAt: parseRfc822(/<time\b[^<>]*\sdatetime=["']([^"']*)["']/i.exec(body)?.[1]),
	};
}

export function parseMetaAiResearch(html: string): ParsedItem[] {
	if (!/\sdata-testid=["']home-content-column["']/.test(html)) {
		throw new Error('not a Meta AI research listing: missing the content column');
	}
	const items: ParsedItem[] = [];
	let bodyStart: number | null = null;
	// Scan boundaries once. A new opening tag abandons an unclosed card, so
	// truncated/nested markup cannot borrow the following card's title or link,
	// or cause repeated scans to the end of a large malformed payload.
	for (const tag of html.matchAll(/<\/?article\b[^<>]*>/gi)) {
		if (tag[0].startsWith('</')) {
			if (bodyStart !== null) {
				const item = parseCard(html.slice(bodyStart, tag.index));
				if (item) items.push(item);
			}
			bodyStart = null;
		} else {
			bodyStart = CARD.test(tag[0]) ? tag.index + tag[0].length : null;
		}
	}
	return items;
}
