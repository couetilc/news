import { XMLParser } from 'fast-xml-parser';
import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';

export interface Rss20Options {
	// Where an item's full HTML lives. Feeds with a `content:encoded` element
	// (Cloudflare blog) keep `description` as a short summary; feeds that put
	// full HTML directly in `description` (IEEE Spectrum) have no summary.
	content: 'content:encoded' | 'description';
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
	const channel = parser.parse(xml).rss?.channel;
	if (!channel) {
		throw new Error('not an RSS 2.0 feed: missing rss > channel');
	}

	const items: ParsedItem[] = [];
	for (const item of channel.item ?? []) {
		// No guid and no link means nothing stable to dedupe on — skip it.
		const guid = textOf(item.guid) ?? textOf(item.link);
		if (!guid) continue;

		const description = textOf(item.description);
		const fromContentEncoded = opts.content === 'content:encoded';
		items.push({
			guid,
			url: textOf(item.link) ?? guid,
			title: textOf(item.title) ?? '',
			summary: fromContentEncoded ? description : null,
			contentHtml: fromContentEncoded ? textOf(item['content:encoded']) : description,
			publishedAt: parseRfc822(textOf(item.pubDate)),
		});
	}
	return items;
}
