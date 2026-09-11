import { article, countCards, dateInText, elements, hasClass, requireCards, text, type Tag } from './lab-html';

// Select article containers independently of title/date/link validity. A
// malformed article fails the poll instead of quietly looking like no news.
const liquidCards = (root: Parameters<typeof elements>[0]) => elements(root, (n) => n.name === 'li' && elements(n, (c) => c.name === 'time').length > 0);
const normalCards = (root: Parameters<typeof elements>[0]) => elements(root, (n) => hasClass(n, 'blog-item') && n.attribs.role === 'listitem');
const piCards = (root: Parameters<typeof elements>[0]) => elements(root, (n) => n.name === 'a' && /^\/(blog|research)\/.+/.test(n.attribs.href ?? ''));
const worldCards = (root: Parameters<typeof elements>[0]) => elements(root, (n) => n.name === 'a' && /^\/blog\/.+/.test(n.attribs.href ?? ''));

export const countLiquid = (html: string): number => countCards(html, liquidCards);
export const countNormal = (html: string): number => countCards(html, normalCards);
export const countPhysicalIntelligence = (html: string): number => countCards(html, piCards);
export const countWorldLabs = (html: string): number => countCards(html, worldCards);

export function parseLiquid(html: string) {
	return requireCards(html, liquidCards).map((card) => {
		const link = elements(card, (n) => n.name === 'a')[0];
		return article(link?.attribs.href, text(link), elements(card, (n) => n.name === 'time')[0].attribs.datetime ?? '', 'https://www.liquid.ai');
	});
}

export function parseNormal(html: string) {
	return requireCards(html, normalCards).map((card) => article(
		elements(card, (n) => n.name === 'a' && hasClass(n, 'link-abs') && !hasClass(n, 'w-condition-invisible'))[0]?.attribs.href,
		text(elements(card, (n) => hasClass(n, 'item-title'))[0]),
		text(elements(card, (n) => hasClass(n, 'item-eyebrow'))[0]),
		'https://www.normalcomputing.com',
	));
}

export function parsePhysicalIntelligence(html: string) {
	return requireCards(html, piCards).map((card) => article(
		card.attribs.href, elements(card, (n) => n.attribs.title !== undefined)[0]?.attribs.title ?? '',
		dateInText(text(card)), 'https://www.pi.website',
	));
}

export function parseWorldLabs(html: string) {
	return requireCards(html, worldCards).map((card) => article(
		card.attribs.href, text(elements(card, (n) => n.name === 'h2')[0]),
		dateInText(text(card)), 'https://www.worldlabs.ai',
	));
}

// xAI's official docs expose stable h3 ids but only month headings (no exact
// publication days). Poll the newest three monthly sections, a rolling listing
// window, and leave publishedAt null. Never date every entry with the page's
// global dateModified or invent the first day of a month.
const MONTH = /^(January|February|March|April|May|June|July|August|September|October|November|December)( \d{4})?$/;
function xaiCards(root: Parameters<typeof elements>[0]): Tag[] {
	const cards: Tag[] = [];
	let months = 0;
	for (const heading of elements(root, (n) => n.name === 'h2' || n.name === 'h3')) {
		if (heading.name === 'h2') {
			if (!MONTH.test(text(heading))) break;
			if (++months > 3) break;
		} else if (months > 0) cards.push(heading);
	}
	return cards;
}

export const countXai = (html: string): number => countCards(html, xaiCards);
export function parseXai(html: string) {
	return requireCards(html, xaiCards).map((heading) => article(
		heading.attribs.id ? `/developers/release-notes#${heading.attribs.id}` : undefined,
		text(heading), null, 'https://docs.x.ai',
	));
}
