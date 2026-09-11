import { parseDocument } from 'htmlparser2';
import type { ParsedItem } from '../types';

type Node = ReturnType<typeof parseDocument>['children'][number];
export type Tag = Extract<Node, { attribs: Record<string, string> }>;

export function formatError(): Error {
	return new Error('not an AI lab listing: missing or invalid article structure');
}

// htmlparser2 decodes entities and repairs ordinary HTML; no scripts execute.
// Bound nesting before card scans, and walk iteratively rather than depending
// on the JavaScript call stack for hostile input. The HTTP runner bounds bytes.
export function document(html: string): Node {
	const root = parseDocument(html);
	const stack: [Node, number][] = [[root, 0]];
	while (stack.length) {
		const [node, depth] = stack.pop()!;
		if (depth > 128) throw formatError();
		if ('children' in node) {
			for (const child of node.children) stack.push([child, depth + 1]);
		}
	}
	return root;
}

export function elements(root: Node, match: (tag: Tag) => boolean): Tag[] {
	const result: Tag[] = [];
	const stack = [root];
	while (stack.length) {
		const node = stack.pop()!;
		if ('attribs' in node && match(node)) result.push(node);
		if ('children' in node) {
			for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
		}
	}
	return result;
}

export function text(root: Node | undefined): string {
	const chunks: string[] = [];
	const stack = root ? [root] : [];
	while (stack.length) {
		const node = stack.pop()!;
		if (node.type === 'text') chunks.push(node.data);
		if ('children' in node && node.type !== 'script' && node.type !== 'style') {
			for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
		}
	}
	return chunks.join('').replace(/\s+/g, ' ').trim();
}

export function hasClass(tag: Tag, name: string): boolean {
	return (tag.attribs.class ?? '').split(/\s+/).includes(name);
}

export function countCards(html: string, cards: (root: Node) => Tag[]): number {
	try { return cards(document(html)).length; } catch { return 0; }
}

export function requireCards(html: string, cards: (root: Node) => Tag[]): Tag[] {
	const result = cards(document(html));
	if (!result.length) throw formatError();
	return result;
}

// These listings publish calendar dates, not local wall-clock times. Validate
// the calendar round trip so February 30 cannot silently become March 2.
export function calendarDate(value: string): number {
	const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
	const english = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/.exec(value);
	let year: number, month: number, day: number;
	if (iso) [year, month, day] = iso.slice(1).map(Number);
	else if (dotted) [month, day, year] = dotted.slice(1).map(Number);
	else if (english) {
		year = Number(english[3]);
		month = 'January February March April May June July August September October November December'.split(' ').indexOf(english[1]) + 1;
		day = Number(english[2]);
	} else throw formatError();
	const date = new Date(Date.UTC(year, month - 1, day));
	if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw formatError();
	return date.getTime() / 1000;
}

export function dateInText(value: string): string {
	return /(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}/.exec(value)?.[0] ?? '';
}

export function articleUrl(href: string | undefined, origin: string): string {
	if (!href) throw formatError();
	let url: URL;
	try { url = new URL(href, origin); } catch { throw formatError(); }
	if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw formatError();
	// Fragments are meaningful for release-note identities. Strip tracking
	// parameters but retain the source's path and heading id.
	url.search = '';
	return url.href;
}

export function article(href: string | undefined, title: string, date: string | null, origin: string): ParsedItem {
	if (!title) throw formatError();
	const url = articleUrl(href, origin);
	return { guid: url, url, title, publishedAt: date === null ? null : calendarDate(date), summary: null, contentHtml: null };
}
