import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';
import { decodeEntities } from './entities';

const ORIGIN = 'https://www.intel.com';

// The new AEM newsroom renders its latest news and category archives as teaser
// anchors. Repeated cards are intentional; the database deduplicates their URLs.
export function parseIntelNewsroom(html: string): ParsedItem[] {
	if (!/\sdata-component=["']card-grid["']/.test(html)) {
		throw new Error('not an Intel newsroom listing: missing card grid');
	}
	const items: ParsedItem[] = [];
	let start: number | null = null;
	let href = '';
	for (const tag of html.matchAll(/<\/?a\b[^<>]*>/gi)) {
		if (!tag[0].startsWith('</')) {
			start = /\sclass=["'][^"']*\bcmp-teaser__link\b/.test(tag[0]) ? tag.index + tag[0].length : null;
			href = /\shref=["']([^"']*)["']/.exec(tag[0])?.[1] ?? '';
			continue;
		}
		if (start === null) continue;
		const body = html.slice(start, tag.index);
		start = null;
		let url: URL;
		try {
			url = new URL(decodeEntities(href), ORIGIN);
		} catch {
			continue;
		}
		if (url.origin !== ORIGIN || !/^\/content\/www\/us\/en\/newsroom\/(?:news|opinion|tech101|press-hub)\/.+\.html$/.test(url.pathname)) continue;
		url.search = '';
		url.hash = '';
		const title = /<h2\b[^<>]*>([\s\S]*?)<\/h2\s*>/i.exec(body)?.[1] ?? '';
		const date = /\b([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\b/.exec(body);
		items.push({
			guid: url.href,
			url: url.href,
			title: decodeEntities(title.replace(/<[^<>]*>/g, '')).replace(/\s+/g, ' ').trim(),
			summary: null,
			contentHtml: null,
			publishedAt: date ? parseRfc822(`${date[2]} ${date[1]} ${date[3]} 00:00:00 GMT`) : null,
		});
	}
	return items;
}
