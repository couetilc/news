import type { ParsedItem } from '../types';
import { calendarDate, document, elements, formatError, requireCards, text, type Tag } from './lab-html';

const ORIGIN = 'https://www.anthropic.com';
const cards = (root: Parameters<typeof elements>[0]) => elements(root, (n) => n.name === 'a' &&
	/(?:FeaturedGrid-\S+__(?:content|sideLink)|PublicationList-\S+__listItem)(?:\s|$)/.test(n.attribs.class ?? ''));

// Count distinct advertised links independently of required title/date fields.
// Featured cards repeat in the publication list; malformed cards still count.
export function countAnthropic(html: string): number {
	try { return new Set(cards(document(html)).map((card) => card.attribs.href)).size; }
	catch { return 0; }
}

function publicationDate(card: Tag): number | null {
	const date = elements(card, (n) => n.name === 'time')[0];
	// Lead slots can promote undated interactive tools rather than publications.
	if (!date && /FeaturedGrid-\S+__content(?:\s|$)/.test(card.attribs.class!)) return null;
	const value = text(date);
	const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/.exec(value);
	if (!match) throw formatError();
	const month = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ').indexOf(match[1]) + 1;
	return calendarDate(`${match[3]}-${String(month).padStart(2, '0')}-${match[2].padStart(2, '0')}`);
}

// Official dated listings only. Their teasers are plain text; full articles
// remain at Anthropic. INSERT ON CONFLICT preserves previously stored bodies.
export function parseAnthropic(html: string): ParsedItem[] {
	const items = new Map<string, ParsedItem>();
	for (const card of requireCards(html, cards)) {
		if (!card.attribs.href) throw formatError();
		let url: URL;
		try { url = new URL(card.attribs.href, ORIGIN); } catch { throw formatError(); }
		if (url.origin !== ORIGIN || url.username || url.password || url.pathname === '/' || /^\/research\/team(?:\/|$)/.test(url.pathname) || /^\/(news|research)\/?$/.test(url.pathname)) throw formatError();
		url.search = '';
		url.hash = '';
		url.pathname = url.pathname.replace(/\/$/, '');
		const title = text(elements(card, (n) => /^(h[2-4])$/.test(n.name) || /(?:^|\s)PublicationList-\S+__title(?:\s|$)/.test(n.attribs.class ?? ''))[0]);
		if (!title) throw formatError();
		const item: ParsedItem = {
			guid: url.href, url: url.href, title, publishedAt: publicationDate(card),
			summary: text(elements(card, (n) => n.name === 'p')[0]) || null, contentHtml: null,
		};
		// Featured cards come first and carry the richer teaser.
		if (!items.has(url.href)) items.set(url.href, item);
	}
	return [...items.values()];
}
