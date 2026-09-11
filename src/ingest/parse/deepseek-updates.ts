import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';
import { decodeEntities } from './entities';

const ORIGIN = 'https://api-docs.deepseek.com';

// Each dated changelog section is one announcement. Some link to a dedicated
// /news/news... page; others (pricing/API updates) only have a changelog anchor.
export function parseDeepseekUpdates(html: string): ParsedItem[] {
	if (!/\bdocs-doc-id-updates\b/.test(html)) {
		throw new Error('not a DeepSeek changelog: missing updates document');
	}
	const headings = [...html.matchAll(/<h2\b[^<>]*>/gi)];
	const items: ParsedItem[] = [];
	for (const [index, heading] of headings.entries()) {
		const date = /\sid=["']date-(\d{4}-\d{2}-\d{2})["']/.exec(heading[0])?.[1];
		if (!date) continue;
		const publishedAt = parseRfc822(`${date}T00:00:00Z`);
		if (publishedAt === null || new Date(publishedAt * 1000).toISOString().slice(0, 10) !== date) continue;
		const body = html.slice(heading.index + heading[0].length, headings[index + 1]?.index ?? html.length);
		const title = /<h3\b[^<>]*>([\s\S]*?)<\/h3\s*>/i.exec(body)?.[1] ?? '';
		const article = /<a\b[^<>]*\shref=["'](\/news\/news[0-9]+)\/?["']/.exec(body)?.[1];
		const url = article ? `${ORIGIN}${article}` : `${ORIGIN}/updates/#date-${date}`;
		items.push({
			// The dated section stays stable if a dedicated article link is added later.
			guid: `${ORIGIN}/updates/#date-${date}`,
			url,
			title: decodeEntities(title.replace(/<a\b[^<>]*>[\s\S]*?<\/a\s*>/gi, '').replace(/<[^<>]*>/g, '')).replace(/\s+/g, ' ').trim(),
			summary: null,
			contentHtml: null,
			publishedAt,
		});
	}
	return items;
}
