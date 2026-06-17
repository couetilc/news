import { XMLParser } from 'fast-xml-parser';
import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';
import { decodeEntities, decodeText } from './entities';

export interface Rss20Options {
	// Where an item's full HTML lives. Feeds with a `content:encoded` element
	// (Cloudflare blog) keep `description` as a short summary; feeds that put
	// full HTML directly in `description` (IEEE Spectrum) have no summary. NVIDIA
	// newsroom (#25) is the same shape as content:encoded but uses a NONSTANDARD
	// bare `<content>` element instead of `content:encoded`, so `'content'` reads
	// the full HTML from `<content>` and keeps `description` as the summary.
	content: 'content:encoded' | 'content' | 'description';
}

// ignoreAttributes: RSS 2.0 bodies we care about are element text, so dropping
// attributes keeps every value a plain string. parseTagValue: false stops
// numeric-looking guids/titles from being coerced to numbers. isArray forces a
// single-item channel to still yield an array.
const parser = new XMLParser({
	ignoreAttributes: true,
	parseTagValue: false,
	isArray: (_name, jpath) => jpath === 'rss.channel.item',
});

function textOf(node: unknown): string | null {
	return typeof node === 'string' && node !== '' ? node : null;
}

export function parseRss20(xml: string, opts: Rss20Options): ParsedItem[] {
	// fast-xml-parser throws its own internal errors on truncated/malformed XML
	// (e.g. "CDATA is not closed", or a TypeError on bad nesting). Treat any such
	// failure as the documented "not an RSS 2.0 feed" rejection rather than letting
	// an undocumented runtime error escape on untrusted input (#165).
	let parsed: { rss?: { channel?: { item?: unknown[] } } };
	try {
		parsed = parser.parse(xml);
	} catch {
		throw new Error('not an RSS 2.0 feed: malformed XML');
	}
	const channel = parsed.rss?.channel;
	if (!channel) {
		throw new Error('not an RSS 2.0 feed: missing rss > channel');
	}

	const items: ParsedItem[] = [];
	for (const item of channel.item ?? []) {
		// No guid and no link means nothing stable to dedupe on — skip it.
		const guid = textOf(item.guid) ?? textOf(item.link);
		if (!guid) continue;

		const description = textOf(item.description);
		// `content:encoded` and the nonstandard bare `content` (NVIDIA newsroom,
		// #25) both keep the full HTML in a dedicated element and treat the
		// description as the summary; only the element name differs. `description`
		// mode instead routes the description into contentHtml with no summary.
		let summary: string | null;
		let contentHtml: string | null;
		if (opts.content === 'content:encoded') {
			summary = description;
			contentHtml = textOf(item['content:encoded']);
		} else if (opts.content === 'content') {
			summary = description;
			contentHtml = textOf(item.content);
		} else {
			summary = null;
			contentHtml = description;
		}
		items.push({
			guid,
			url: textOf(item.link) ?? guid,
			// Decode HTML entities in the plain-text fields (#224): some feeds
			// (science-daily) are double-encoded, so `&amp;#039;` arrives here as
			// `&#039;` and must become `'`. `summary` is the description routed to a
			// summary; `contentHtml` carries markup and is deliberately left as-is.
			title: decodeEntities(textOf(item.title) ?? ''),
			summary: decodeText(summary),
			contentHtml,
			publishedAt: parseRfc822(textOf(item.pubDate)),
		});
	}
	return items;
}
