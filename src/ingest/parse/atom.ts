import { XMLParser } from 'fast-xml-parser';
import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';

export interface AtomOptions {
	// Where an entry's body lives, mirroring Rss20Options.content. Atom feeds vary:
	//   'content'  — full HTML in <content>, with <summary> as the short summary
	//   'summary'  — full HTML in <summary> (rare), no separate summary kept
	//   'summary-only' — the feed links out and only carries a one-liner; that
	//                    one-liner (in <content>, e.g. Apple Newsroom) becomes the
	//                    summary and contentHtml stays null. Apple's <content> is a
	//                    teaser sentence, not the article body, so storing it as
	//                    full HTML would be wrong.
	content: 'content' | 'summary' | 'summary-only';
}

// Atom links carry the URL in an href attribute and an entry may have several
// (alternate article link, rel="enclosure" image, rel="self", …), so unlike the
// RSS parser we must KEEP attributes. parseTagValue: false stops numeric-looking
// ids/titles from being coerced to numbers. textNodeName names the key fast-xml-
// parser uses for an element's text when that element also has attributes (e.g.
// <content type="html">…</content>). isArray forces single entry/link nodes to
// still be arrays so the loops below are uniform.
const TEXT = '#text';
const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	textNodeName: TEXT,
	parseTagValue: false,
	isArray: (_name, jpath) => jpath === 'feed.entry' || jpath === 'feed.entry.link',
});

// A node is either a bare string (no attributes) or an object whose text sits
// under TEXT (had attributes; an attribute-only/empty element has no TEXT key).
// Pull out the candidate string from either shape, then keep it only if
// non-empty. fast-xml-parser (parseTagValue: false) always yields strings, so a
// present TEXT value is a string; the typeof guard just narrows the type.
function textOf(node: unknown): string | null {
	let t: unknown = node;
	if (node && typeof node === 'object' && TEXT in node) {
		t = (node as Record<string, unknown>)[TEXT];
	}
	return typeof t === 'string' && t !== '' ? t : null;
}

interface AtomLink {
	'@_href'?: string;
	'@_rel'?: string;
}

// The canonical article URL: the first <link> with no rel or rel="alternate".
// Skips rel="enclosure" (Apple attaches a hero image that way) and rel="self".
function articleLink(links: AtomLink[]): string | null {
	for (const link of links) {
		const rel = link['@_rel'];
		if ((rel === undefined || rel === 'alternate') && typeof link['@_href'] === 'string') {
			return link['@_href'];
		}
	}
	return null;
}

export function parseAtom(xml: string, opts: AtomOptions): ParsedItem[] {
	// fast-xml-parser throws its own internal errors on truncated/malformed XML
	// (e.g. a TypeError reading 'addChild' on bad tag nesting). Treat any such
	// failure as the documented "not an Atom feed" rejection rather than letting an
	// undocumented runtime error escape on untrusted input (#165).
	let parsed: { feed?: { entry?: unknown[] } };
	try {
		parsed = parser.parse(xml);
	} catch {
		throw new Error('not an Atom feed: malformed XML');
	}
	const feed = parsed.feed;
	if (!feed) {
		throw new Error('not an Atom feed: missing feed root');
	}

	const items: ParsedItem[] = [];
	for (const entry of feed.entry ?? []) {
		const url = articleLink(entry.link ?? []);
		// No <id> and no usable link means nothing stable to dedupe on — skip it.
		const guid = textOf(entry.id) ?? url;
		if (!guid) continue;

		const content = textOf(entry.content);
		const summary = textOf(entry.summary);
		// Atom dates: <published> when present, else <updated> (Apple emits only
		// <updated>). Both are ISO-8601, which parseRfc822 handles via Date.parse.
		const published = textOf(entry.published) ?? textOf(entry.updated);

		let summaryOut: string | null;
		let contentOut: string | null;
		if (opts.content === 'content') {
			summaryOut = summary;
			contentOut = content;
		} else if (opts.content === 'summary') {
			summaryOut = null;
			contentOut = summary;
		} else {
			// summary-only: <content> is a teaser; keep it as the summary, no body.
			summaryOut = content;
			contentOut = null;
		}

		items.push({
			guid,
			url: url ?? guid,
			title: textOf(entry.title) ?? '',
			summary: summaryOut,
			contentHtml: contentOut,
			publishedAt: parseRfc822(published),
		});
	}
	return items;
}
