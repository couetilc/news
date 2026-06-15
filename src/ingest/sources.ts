import { parseAtom } from './parse/atom';
import { parseAwsWhatsNew } from './parse/aws-whats-new';
import { parseEdgar8k } from './parse/edgar-8k';
import { parseRss20 } from './parse/rss20';
import type { FeedConfig } from './types';

// #26 — Annapurna's silicon ships through AWS's What's New JSON search API.
// Tags are unreliable (Graviton launches carry only `amazon-ec2`), so we run a
// free-text `q=` query per term. Each term is its own FeedConfig sharing
// `source: 'aws'`: run.ts polls each URL independently and insertItems dedupes
// by (source, guid), so a launch that matches two terms collapses to one row —
// no bespoke cross-query dedupe needed. The JSON API ignores conditional-GET,
// which run.ts already tolerates (it just re-parses a 200). ~a few/week, so a
// 6-hour poll per term is ample.
const AWS_TERMS = ['graviton', 'trainium', 'inferentia', 'nitro'] as const;

function awsFeed(term: string): FeedConfig {
	const url = new URL('https://aws.amazon.com/api/dirs/items/search');
	url.searchParams.set('item.directoryId', 'whats-new-v2');
	url.searchParams.set('sort_by', 'item.additionalFields.postDateTime');
	url.searchParams.set('sort_order', 'desc');
	url.searchParams.set('size', '10');
	url.searchParams.set('item.locale', 'en_US');
	url.searchParams.set('q', term);
	return {
		source: 'aws',
		feed: url.toString(),
		pollIntervalSeconds: 21600,
		parse: parseAwsWhatsNew,
	};
}

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
	{
		// #27 — WordPress RSS, 10-item window, excerpts only (no content:encoded) so
		// we link out for full text; ~3–5/week, so poll daily. content:encoded mode
		// routes the <description> excerpt into `summary` and leaves contentHtml null.
		source: 'intel',
		feed: 'https://newsroom.intel.com/feed',
		pollIntervalSeconds: 86400,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
	},
	{
		// #25 — NVIDIA newsroom (iPressroom RSS 2.0). FULL release text lives in a
		// NONSTANDARD bare <content> element (escaped CDATA), NOT content:encoded —
		// the `'content'` mode reads it and keeps <description> as the summary. The
		// feed is only 5 items deep and ignores ?count=, so poll hourly to avoid
		// dropping items during event weeks (GTC/CES).
		source: 'nvidia',
		feed: 'https://nvidianews.nvidia.com/releases.xml',
		pollIntervalSeconds: 3600,
		parse: (xml) => parseRss20(xml, { content: 'content' }),
	},
	{
		// #25 — NVIDIA corporate blog (WordPress RSS), full text via content:encoded;
		// several posts/week, so poll daily. Shares the `nvidia` source slug with the
		// newsroom feed (run.ts polls each feed independently).
		source: 'nvidia',
		feed: 'https://blogs.nvidia.com/feed/',
		pollIntervalSeconds: 86400,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
	},
	{
		// #23 — Elon Litman's blog (Pelican-generated Atom). Full HTML is in
		// <content type="html"> with a separate <summary> excerpt. Low cadence
		// (a few posts/year), so a daily poll is plenty.
		source: 'elonlit',
		feed: 'https://elonlit.com/feeds/all.atom.xml',
		pollIntervalSeconds: 86400,
		parse: (xml) => parseAtom(xml, { content: 'content' }),
	},
	// #22 — Anthropic has no official feed, so we read each section through the
	// OpenRSS proxy. All three are RSS 2.0 with the full rendered article HTML in
	// the <description> CDATA (no content:encoded), so `description` mode routes
	// that body into contentHtml and leaves summary null — same path as IEEE
	// Spectrum/Qualcomm. They share one `source: 'anthropic'`; run.ts isolates
	// each feed, so an OpenRSS outage on one section never aborts the others.
	// OpenRSS sends Cache-Control: max-age=32400 (9h) and each feed mirrors only
	// the ~10-item landing page, so poll 3×/day (8h) — anything tighter just
	// re-fetches the cached copy.
	{
		source: 'anthropic',
		feed: 'https://openrss.org/feed/www.anthropic.com/news',
		pollIntervalSeconds: 28800,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
	},
	{
		source: 'anthropic',
		feed: 'https://openrss.org/feed/www.anthropic.com/research',
		pollIntervalSeconds: 28800,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
	},
	{
		source: 'anthropic',
		feed: 'https://openrss.org/feed/www.anthropic.com/engineering',
		pollIntervalSeconds: 28800,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
	},
	{
		// #31 — Cisco IR press releases (Q4 Inc RSS 2.0), the PRIMARY earnings
		// signal. Titles only: <description> is empty, so `description` mode yields
		// null contentHtml and we link out. The earnings PR lands ~16:05 ET on the
		// day (title matches /REPORTS .* QUARTER EARNINGS/i), preceded ~2 weeks
		// earlier by a "Schedules Conference Call" PR. ~2–4/month, but the release
		// is time-critical, so poll hourly. Use EXACTLY this `.aspx` path — other
		// IR-host paths (e.g. /rss/news-releases.xml) are Cloudflare-challenged (403).
		// pubDates carry a numeric offset (`... -0400`), which Date.parse handles.
		source: 'cisco',
		feed: 'https://investor.cisco.com/rss/pressrelease.aspx',
		pollIntervalSeconds: 3600,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
	},
	{
		// #31 — SEC EDGAR 8-K BACKSTOP for Cisco (CIK 0000858877). The earnings 8-K
		// lands within minutes of the IR PR, so it's a safety net if the IR feed is
		// Cloudflare-challenged or lags. browse-edgar's Atom output carries every
		// 8-K (director changes, bylaws, …); parseEdgar8k keeps only the earnings
		// ones (SEC Item 2.02, "Results of Operations") and dedupes on the
		// accession number. EDGAR requires the contact-bearing User-Agent run.ts
		// already sends, and asks for ≤10 req/s — hourly is far under that. Shares
		// the `cisco` slug with the IR feed; the two use disjoint guid schemes
		// (UUID vs accession), so an earnings event surfaces as two rows by design.
		source: 'cisco',
		feed: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000858877&type=8-K&output=atom&count=10',
		pollIntervalSeconds: 3600,
		parse: parseEdgar8k,
	},
	// #26 — one entry per silicon term, all source 'aws' (see awsFeed above).
	...AWS_TERMS.map(awsFeed),
];
