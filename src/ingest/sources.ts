import { parseAtom } from './parse/atom';
import { parseRss20 } from './parse/rss20';
import type { FeedConfig } from './types';

// The configured feeds. v1 ships the two easiest full-text sources (#19, #20);
// further `Source:` issues add entries here. Each carries its own parser
// closure so per-source quirks stay local to this list.
export const SOURCES: FeedConfig[] = [
	{
		// #19 — full HTML in content:encoded; no conditional GET; 20-item window
		// that bursts during Innovation Weeks, so poll hourly.
		source: 'cloudflare-blog',
		feed: 'https://blog.cloudflare.com/rss/',
		pollIntervalSeconds: 3600,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
	},
	{
		// #20 — full HTML in the description CDATA (not content:encoded); supports
		// conditional GET; ~1–2/day, so two hours between polls is plenty.
		source: 'ieee-spectrum',
		feed: 'https://spectrum.ieee.org/feeds/feed.rss',
		pollIntervalSeconds: 7200,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
	},
	{
		// #29 — Atom despite the .rss extension. Each <entry> carries a one-liner
		// teaser in <content> (not the full release) and links out; <updated> is
		// the only timestamp. Tagged <category term="PRESS RELEASE"|"UPDATE"> — we
		// keep both. ~2–5/week, so poll daily.
		source: 'apple',
		feed: 'https://www.apple.com/newsroom/rss-feed.rss',
		pollIntervalSeconds: 86400,
		parse: (xml) => parseAtom(xml, { content: 'summary-only' }),
	},
	{
		// #21 — the all.xml firehose: summaries only (233–524 char rewritten press
		// releases in description; no content:encoded), so description IS the
		// summary. ttl=60 and Last-Modified support conditional GET; ~10/day in a
		// 60-item window, so poll hourly.
		source: 'science-daily',
		feed: 'https://www.sciencedaily.com/rss/all.xml',
		pollIntervalSeconds: 3600,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
	},
	{
		// #24 — AMD investor-relations press releases (Equisolve RSS 2.0).
		// Titles only: <description> is empty, so we read the body slot from
		// `description` (yielding null contentHtml) and link out. ~2–4/month with a
		// 10-item window, so a 6-hour poll is plenty. pubDates use two-digit years
		// (`Mon, 08 Jun 26`) — Date.parse handles that (see parse/dates.ts).
		source: 'amd',
		feed: 'https://ir.amd.com/news-events/press-releases/rss',
		pollIntervalSeconds: 21600,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
	},
	{
		// #28 — Q4 Inc RSS 2.0 with full Business Wire HTML in the description; only
		// ~2–4/month, so a six-hour poll is ample. Use EXACTLY this `.aspx` path —
		// other IR-host paths (e.g. /rss/news-releases.xml) are Cloudflare-challenged,
		// and qualcomm.com itself has no RSS.
		source: 'qualcomm',
		feed: 'https://investor.qualcomm.com/rss/pressrelease.aspx',
		pollIntervalSeconds: 21600,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
	},
];
