import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';
import { decodeEntities } from './entities';

// #352 — Thinking Machines Lab /news/ announcements (Tinker/Inkling releases,
// grants, partnerships). NO feed covers this section anywhere (probed
// 2026-08-30, re-verified on implementation): the first-party /news/index.xml
// 404s, the root index.xml (polled by the sibling #338 entry) carries only the
// /blog/ posts, and the OpenRSS proxy returns an empty channel — its extractor
// doesn't understand the listing markup. What IS reliable is the
// server-rendered static listing at /news/ (the site is Astro-built): each
// post is a row anchor
//   <li><a class="post-item-link" href="/news/<slug>/">
//     <div class="post-info"><h2 class="post-title">Title</h2></div>
//     <time datetime="2026-08-27">Aug 27, 2026</time></a></li>
// inside an <ol class="post-group"> container. Rows carry title/link/date only
// (no teaser), so summary and contentHtml are null and we LINK OUT.
//
// GOTCHAS (flagged for future maintainers):
//   • The page FOOTER also links /news/<slug>/ article pages (plain anchors
//     with no class), so row detection keys on the post-item-link class, never
//     on the href prefix.
//   • Astro stamps a per-build data-astro-cid-* attribute on every listing
//     element — treat it as noise that changes across site builds; nothing
//     here matches on it.
//   • <time datetime> is DATE-ONLY ("2026-08-27"): Date.parse reads that as
//     midnight UTC, matching the root feed's midnight-UTC pubDates, so a post
//     that ever appears in both collapses cleanly at (source, guid).
//   • This parses UNTRUSTED HTML with hand-rolled scanning (no HTML parser in
//     the runtime): every regex keeps a single unambiguous [^>]*/[^"]* gap so
//     adversarial input degrades linearly (never hangs), and any element-level
//     junk — a row with no href or no closing </a> — is skipped, never thrown.

const ORIGIN = 'https://thinkingmachines.ai';

// A row anchor's class attribute — the listing-row marker. The footer's /news/
// anchors carry no class attribute at all, so they can never match.
const ROW_CLASS = /\bclass="[^"]*\bpost-item-link\b[^"]*"/;
const HREF = /\bhref="([^"]*)"/;
// i-flag: tolerate a future React-style dateTime= respelling (the Cursor
// precedent), though the live Astro markup renders lowercase datetime=.
const TIME_DATETIME = /<time\s[^>]*\bdatetime="([^"]*)"/i;
// The row's only <h2> (class post-title) is the post title.
const TITLE_H2 = /<h2\b[^>]*>([\s\S]*?)<\/h2>/;

// Inner text of an HTML fragment: strip tags, then decode character references
// (#224) and trim — a title-less/blank row degrades to '' (which validate.ts
// flags as a missing required field, the intended drift signal).
function titleText(fragment: string): string {
	return decodeEntities(fragment.replace(/<[^>]*>/g, '')).trim();
}

// Row hrefs are site-relative ("/news/<slug>/"); pass an absolute one through.
function resolveUrl(href: string): string {
	return /^https?:\/\//.test(href) ? href : `${ORIGIN}${href}`;
}

export function parseThinkingMachinesNews(html: string): ParsedItem[] {
	// A payload with no post-group marker anywhere is recognizably the wrong
	// document — an error page, a bot challenge, a full redesign. That's the
	// documented rejection (caught per-feed in run.ts), not a silent empty
	// parse. A listing whose container is present but empty (or whose rows have
	// drifted) still parses below — to [] — which validate.ts then flags against
	// countThinkingMachinesNews's raw count.
	if (!html.includes('post-group')) {
		throw new Error(
			'not a Thinking Machines news listing: missing the post-group container',
		);
	}

	const items: ParsedItem[] = [];
	// Every anchor OPEN tag; the row-class test below picks out the listing rows.
	const anchorOpen = /<a\s([^>]*)>/g;
	let anchor: RegExpExecArray | null;
	while ((anchor = anchorOpen.exec(html)) !== null) {
		const attrs = anchor[1];
		// Nav/footer/press-contact anchors aren't listing rows — skip them.
		if (!ROW_CLASS.test(attrs)) continue;
		// The row link is the article URL and our dedupe key — skip a row with a
		// missing or empty href (both falsy: nothing stable to dedupe on).
		const href = HREF.exec(attrs)?.[1];
		if (!href) continue;
		// The row body runs to the anchor's close; a truncated row is junk.
		const bodyStart = anchor.index + anchor[0].length;
		const bodyEnd = html.indexOf('</a>', bodyStart);
		if (bodyEnd === -1) continue;
		const body = html.slice(bodyStart, bodyEnd);

		const url = resolveUrl(href);
		items.push({
			guid: url,
			url,
			title: titleText(TITLE_H2.exec(body)?.[1] ?? ''),
			// Listing rows carry no teaser — link out for everything.
			summary: null,
			contentHtml: null,
			publishedAt: parseRfc822(TIME_DATETIME.exec(body)?.[1]),
		});
	}
	return items;
}
