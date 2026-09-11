import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';
import { decodeEntities } from './entities';

const ORIGIN = 'https://www.inceptionlabs.ai';

function titleText(body: string): string {
	const open = /<h([1-6])\b[^<>]*>/i.exec(body);
	if (!open) return '';
	const tail = body.slice(open.index + open[0].length);
	const end = new RegExp(`</h${open[1]}\\s*>`, 'i').exec(tail)?.index ?? 0;
	return decodeEntities(tail.slice(0, end).replace(/<[^<>]*>/g, ''))
		.replace(/\s+/g, ' ').trim();
}

function parseCard(attrs: string, body: string): ParsedItem | null {
	// The banner/navigation repeats the featured link without a date. Only
	// dated article cards belong to the listing, including its featured hero.
	if (!/<time\b/i.test(body)) return null;
	const href = /\shref=["']([^"']*)["']/i.exec(attrs)?.[1];
	if (!href) return null;
	let url: URL;
	try {
		url = new URL(decodeEntities(href), ORIGIN);
	} catch {
		return null;
	}
	// External press links also appear in the blog; follow first-party posts
	// only. Remove tracking/fragment variants from the durable identity.
	if (url.origin !== ORIGIN || url.username || url.password || !/^\/blog\/[a-z0-9-]+\/?$/i.test(url.pathname)) return null;
	url.search = '';
	url.hash = '';
	url.pathname = url.pathname.replace(/\/$/, '');
	const publishedAt = parseRfc822(/<time\b[^<>]*\sdatetime=["']([^"']*)["']/i.exec(body)?.[1]);
	// The initial-backfill filter requires dates. Surface date-shape drift as a
	// failed poll instead of silently filtering every new article out.
	if (publishedAt === null) throw new Error('not an Inception blog listing: card missing a valid date');
	return {
		guid: url.href,
		url: url.href,
		title: titleText(body),
		summary: null,
		contentHtml: null,
		publishedAt,
	};
}

// Framer serves featured h3 and regular h6 cards without a declared RSS feed.
// Match semantic anchors/headings/time, never generated classes. Responsive
// copies are retained here and counted by countRaw; normal (source, guid) D1
// deduplication collapses them, avoiding false parse-drop alerts on healthy HTML.
export function parseInceptionBlog(html: string): ParsedItem[] {
	if (!/<h1\b[^<>]*>\s*Blog\s*<\/h1\s*>/i.test(html)) {
		throw new Error('not an Inception blog listing: missing the Blog heading');
	}
	const items: ParsedItem[] = [];
	let anchor: RegExpExecArray | null = null;
	// A fresh opening anchor abandons an unclosed one. Every body is scanned
	// at most once, so malformed cards cannot borrow another card's fields.
	for (const tag of html.matchAll(/<\/?a\b[^<>]*>/gi)) {
		if (tag[0].startsWith('</')) {
			if (anchor !== null) {
				const item = parseCard(anchor[0], html.slice(anchor.index + anchor[0].length, tag.index));
				if (item) items.push(item);
			}
			anchor = null;
		} else {
			anchor = tag;
		}
	}
	return items;
}
