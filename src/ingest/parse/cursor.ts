import type { ParsedItem } from '../types';
import { parseRfc822 } from './dates';
import { decodeEntities } from './entities';

// #335 — Cursor's blog (cursor.com), research topic. The official
// https://cursor.com/rss.xml went stale ~Sept 2025 and by 2026-08 doesn't even
// serve XML any more — the URL 200s with the marketing homepage as text/html —
// so there is no feed to parse. The site is Next.js App Router with RSC: no
// __NEXT_DATA__, no /_next/data/* JSON, no clean JSON endpoint. What IS
// reliable is the server-rendered topic listing at /blog/topic/research: plain
// HTML where each post is a card anchor
//   <a class="blog-directory__row …" href="/blog/<slug>">
//     …<time dateTime="2026-08-18T12:00:00.000Z">Aug 18, 2026</time>
//     …<p class="type-base …">Git at any scale</p>…author/read-time spans…
//   </a>
// inside a `blog-directory` container. Cards carry title/link/date only (no
// teaser), so summary and contentHtml are null and we LINK OUT.
//
// GOTCHAS (flagged for future maintainers):
//   • DUPLICATE SSR RENDER: the live page streams the whole listing TWICE
//     (a Next.js streaming artifact), so every card appears two times in the
//     HTML. The parser deliberately emits one item per card occurrence —
//     insertItems collapses repeats on (source, guid), the designed dedupe
//     point (#191) — so countCursorBlog's raw count (same anchors) stays an
//     honest drift denominator instead of tripping parse_drop on every poll.
//   • RSC FLIGHT BLOBS: the self.__next_f.push(<script>) payloads escape their
//     quotes (className=\"…\") and use React prop casing, so the literal
//     `class="blog-directory__row"` match below never fires inside them.
//   • This parses UNTRUSTED HTML with hand-rolled scanning (no HTML parser in
//     the runtime): every regex keeps a single unambiguous [^>]*/[^"]* gap so
//     adversarial input degrades linearly (never hangs), and any element-level
//     junk — a card with no href or no closing </a> — is skipped, never thrown.

const ORIGIN = 'https://cursor.com';

// A card anchor's class attribute — the listing-row marker. The RSC flight
// blobs escape their quotes, so this literal `class="` can't match there.
const ROW_CLASS = /\bclass="[^"]*\bblog-directory__row\b[^"]*"/;
const HREF = /\bhref="([^"]*)"/;
// React renders the attribute as dateTime=, i-flag for plain datetime= too.
const TIME_DATETIME = /<time\s[^>]*\bdatetime="([^"]*)"/i;
// The card's only <p> is the post title.
const TITLE_P = /<p\b[^>]*>([\s\S]*?)<\/p>/;

// Inner text of an HTML fragment: strip tags, then decode character references
// (#224) and trim — a title-less/blank card degrades to '' (which validate.ts
// flags as a missing required field, the intended drift signal).
function titleText(fragment: string): string {
	return decodeEntities(fragment.replace(/<[^>]*>/g, '')).trim();
}

// Card hrefs are site-relative ("/blog/<slug>"); pass an absolute one through.
function resolveUrl(href: string): string {
	return /^https?:\/\//.test(href) ? href : `${ORIGIN}${href}`;
}

export function parseCursorBlog(html: string): ParsedItem[] {
	// A payload with no blog-directory marker anywhere is recognizably the wrong
	// document — the homepage the dead rss.xml URL serves, an error page, a full
	// redesign. That's the documented rejection (caught per-feed in run.ts), not
	// a silent empty parse. A listing whose container is present but empty (or
	// whose cards have drifted) still parses below — to [] — which validate.ts
	// then flags against countCursorBlog's raw count.
	if (!html.includes('blog-directory')) {
		throw new Error('not a Cursor blog listing: missing the blog-directory container');
	}

	const items: ParsedItem[] = [];
	// Every anchor OPEN tag; the row-class test below picks out the cards.
	const anchorOpen = /<a\s([^>]*)>/g;
	let anchor: RegExpExecArray | null;
	while ((anchor = anchorOpen.exec(html)) !== null) {
		const attrs = anchor[1];
		// Breadcrumb/nav/footer anchors aren't listing rows — skip them.
		if (!ROW_CLASS.test(attrs)) continue;
		// The card link is the article URL and our dedupe key — skip a card with a
		// missing or empty href (both falsy: nothing stable to dedupe on).
		const href = HREF.exec(attrs)?.[1];
		if (!href) continue;
		// The card body runs to the anchor's close; a truncated card is junk.
		const bodyStart = anchor.index + anchor[0].length;
		const bodyEnd = html.indexOf('</a>', bodyStart);
		if (bodyEnd === -1) continue;
		const body = html.slice(bodyStart, bodyEnd);

		const url = resolveUrl(href);
		items.push({
			guid: url,
			url,
			title: titleText(TITLE_P.exec(body)?.[1] ?? ''),
			// Listing cards carry no teaser — link out for everything.
			summary: null,
			contentHtml: null,
			publishedAt: parseRfc822(TIME_DATETIME.exec(body)?.[1]),
		});
	}
	return items;
}
