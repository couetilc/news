import { parseAtom } from './parse/atom';
import { parseAwsWhatsNew } from './parse/aws-whats-new';
import { parseJpmEotm } from './parse/jpm-eotm';
import { parseOwenomics } from './parse/owenomics';
import { parseRss20 } from './parse/rss20';
import { parseSecEdgar } from './parse/sec-edgar';
import { parseTiNewsroom } from './parse/ti-newsroom';
import {
	countAtom,
	countAwsWhatsNew,
	countJpmEotm,
	countOwenomics,
	countRss20,
	countTiNewsroom,
} from './parse/count';
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

// #321 — region-expansion drop rule, applied source-wide (all four q= terms).
// The q= queries are FULL-TEXT over the release body, so q=nitro matches
// essentially every new EC2 instance ("built on the AWS Nitro System") and
// q=graviton every Arm-instance rollout: ~55–60% of those results are
// "<instance> now available in <region(s)>" regional-availability noise. The
// launch itself ("Introducing …", "Announcing …", "… launches …", a first GA
// with no region clause like "M9g instances are now available") never carries
// an "available in … region(s)" clause, so a headline match on that phrase is
// the rollout, not the launch. Deliberately conservative — it requires BOTH
// "available in" and a trailing "region(s)" — so a borderline item stays in
// rather than risk dropping a real launch. run.ts applies `keep` after the
// shape-drift check (see FeedConfig.keep), so this can't trip parse_drop.
const AWS_REGION_ROLLOUT = /\bavailable in\b.*\bregions?\b/i;

// #337 — first-poll flood control for OpenAI: the feed is the FULL ~1,157-item
// archive back to 2015, so without a cutoff the first poll would insert a
// decade of backfill. Drop anything published before the source's launch here
// (2026-08-01T00:00:00Z). See the FeedConfig entry for the conservative
// missing-date choice.
const OPENAI_LAUNCH_CUTOFF = Date.UTC(2026, 7, 1) / 1000;

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
		countRaw: countAwsWhatsNew,
		keep: (item) => !AWS_REGION_ROLLOUT.test(item.title),
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
		countRaw: countRss20,
	},
	{
		// #20 — full HTML in the description CDATA (not content:encoded); supports
		// conditional GET; ~1–2/day, so two hours between polls is plenty.
		source: 'ieee-spectrum',
		feed: 'https://spectrum.ieee.org/feeds/feed.rss',
		pollIntervalSeconds: 7200,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
		countRaw: countRss20,
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
		countRaw: countAtom,
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
		countRaw: countRss20,
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
		countRaw: countRss20,
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
		countRaw: countRss20,
	},
	{
		// #27 — WordPress RSS, 10-item window, excerpts only (no content:encoded) so
		// we link out for full text; ~3–5/week, so poll daily. content:encoded mode
		// routes the <description> excerpt into `summary` and leaves contentHtml null.
		source: 'intel',
		feed: 'https://newsroom.intel.com/feed',
		pollIntervalSeconds: 86400,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
		countRaw: countRss20,
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
		countRaw: countRss20,
	},
	{
		// #25 — NVIDIA corporate blog (WordPress RSS), full text via content:encoded;
		// several posts/week, so poll daily. Shares the `nvidia` source slug with the
		// newsroom feed (run.ts polls each feed independently).
		source: 'nvidia',
		feed: 'https://blogs.nvidia.com/feed/',
		pollIntervalSeconds: 86400,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
		countRaw: countRss20,
	},
	{
		// #23 — Elon Litman's blog (Pelican-generated Atom). Full HTML is in
		// <content type="html"> with a separate <summary> excerpt. Low cadence
		// (a few posts/year), so a daily poll is plenty.
		source: 'elonlit',
		feed: 'https://elonlit.com/feeds/all.atom.xml',
		pollIntervalSeconds: 86400,
		parse: (xml) => parseAtom(xml, { content: 'content' }),
		countRaw: countAtom,
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
		countRaw: countRss20,
	},
	{
		source: 'anthropic',
		feed: 'https://openrss.org/feed/www.anthropic.com/research',
		pollIntervalSeconds: 28800,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
		countRaw: countRss20,
	},
	{
		source: 'anthropic',
		feed: 'https://openrss.org/feed/www.anthropic.com/engineering',
		pollIntervalSeconds: 28800,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
		countRaw: countRss20,
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
		countRaw: countRss20,
	},
	{
		// #31 — SEC EDGAR 8-K BACKSTOP for Cisco (CIK 0000858877). The earnings 8-K
		// lands within minutes of the IR PR, so it's a safety net if the IR feed is
		// Cloudflare-challenged or lags. #71 moved this off the robots-disallowed
		// /cgi-bin browse-edgar Atom feed onto data.sec.gov (the documented JSON
		// submissions API, same one TI uses). The submissions JSON carries every
		// 8-K (director changes, bylaws, …); the `items: ['2.02']` filter keeps only
		// the earnings ones (SEC Item 2.02, "Results of Operations") and dedupes on
		// the accession number. EDGAR requires the contact-bearing User-Agent run.ts
		// already sends, and asks for ≤10 req/s — hourly is far under that. Shares
		// the `cisco` slug with the IR feed; the two use disjoint guid schemes
		// (UUID vs accession), so an earnings event surfaces as two rows by design.
		source: 'cisco',
		feed: 'https://data.sec.gov/submissions/CIK0000858877.json',
		pollIntervalSeconds: 3600,
		parse: (json) =>
			parseSecEdgar(json, { cik: '858877', issuer: 'Cisco', items: ['2.02'] }),
	},
	// #26 — one entry per silicon term, all source 'aws' (see awsFeed above).
	...AWS_TERMS.map(awsFeed),
	{
		// #30 — Texas Instruments NEWS RELEASES. The ti.com newsroom has no
		// RSS/Atom (no <link rel="alternate"> on the page); its News Releases list
		// is rendered client-side from an AEM JSON endpoint — /bin/ti/newsroom with
		// type=news — which the page's newsFilterGoup clientlib calls directly. We
		// poll page=1 with no category/year filters (categories=none&years=none) to
		// get the newest ~10 releases (product/technology launches + investor PRs).
		// parseTiNewsroom reads the array shape (index 0 is a count; records follow)
		// and links out (teaser-only listing, so contentHtml is null). ~a few/week,
		// so a 6-hour poll is ample.
		source: 'ti',
		feed: 'https://www.ti.com/bin/ti/newsroom?page=1&lang=en-us&categories=none&years=none&type=news',
		pollIntervalSeconds: 21600,
		parse: parseTiNewsroom,
		countRaw: countTiNewsroom,
	},
	{
		// #30 — Texas Instruments COMPANY BLOG. Same AEM JSON endpoint and record
		// shape as the news releases above, but type=blog (the page's separate
		// blogFilterGoup clientlib calls it). Shares the `ti` source slug; run.ts
		// polls each feed URL independently and insertItems dedupes by (source,
		// guid=article path), so the blog and news lists can't collide even if an
		// item were cross-listed. A few posts/week, so poll daily.
		source: 'ti',
		feed: 'https://www.ti.com/bin/ti/newsroom?page=1&lang=en-us&categories=none&years=none&type=blog',
		pollIntervalSeconds: 86400,
		parse: parseTiNewsroom,
		countRaw: countTiNewsroom,
	},
	{
		// #30 — Texas Instruments SEC EDGAR 8-K filings. The owner explicitly wants
		// TI's corporate filings surfaced alongside the newsroom feeds above. The
		// one reliable, officially-supported financial channel is the SEC EDGAR
		// submissions API for TXN (CIK 0000097476) — JSON, not a feed. parseSecEdgar
		// keeps only 8-K current reports (material events: earnings, leadership,
		// etc.), so this is TI's CORPORATE news, not product launches (those come
		// through the news/blog feeds above). Picked data.sec.gov (the documented
		// data API, no robots disallow) over the /cgi-bin browse-edgar Atom feed
		// (robots-disallowed). SEC requires a contact-bearing User-Agent, which
		// run.ts already sends. Filings are ~1–2/month, so a 12-hour poll is ample.
		source: 'ti',
		feed: 'https://data.sec.gov/submissions/CIK0000097476.json',
		pollIntervalSeconds: 43200,
		parse: (json) => parseSecEdgar(json, { cik: '97476', issuer: 'Texas Instruments' }),
	},
	{
		// #338 — Thinking Machines Lab. The ROOT feed (the site's declared
		// rel=alternate) — RSS 2.0 with the FULL post HTML in content:encoded and
		// NO <description> at all (probed 2026-08-30; the issue's "summaries only"
		// research predates the current feed), so content:encoded mode stores the
		// full text and summary stays null. Guids are the permalink URLs.
		// Today it carries exactly the /blog/ ("Connectionism") posts — identical
		// to /blog/index.xml — but it's section-agnostic, so if the site ever
		// syndicates /news/ those items land here with no config change. The
		// /news/ announcements have NO working feed anywhere (first-party
		// /news/index.xml 404s, OpenRSS returns an empty channel, the community
		// mirror is blog-only) — tracked separately, see the issue. Mostly
		// date-only midnight-UTC pubDates (Date.parse handles them, see
		// parse/dates.ts); ~1 post every 6 weeks, so a daily poll is ample.
		source: 'thinking-machines',
		feed: 'https://thinkingmachines.ai/index.xml',
		pollIntervalSeconds: 86400,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
		countRaw: countRss20,
	},
	{
		// #319 — JPMorgan Asset Management's "Eye on the Market" (Michael Cembalest),
		// the ongoing weekly/biweekly commentary stream. The landing page is a
		// client-rendered AEM app with NO RSS/Atom and no first-party feed; its
		// static HTML lists only a few curated annual outlooks. The full article
		// stream is rendered client-side from the editorial-landing component's AEM
		// `.model.json` (a JSON object whose `pages` array holds the records,
		// newest first) — the same AEM-JSON discovery path as Texas Instruments
		// (#30). parseJpmEotm reads `pages`, resolves the site-relative article
		// `url` to an absolute one (the stable guid), keeps the teaser `description`
		// as the summary, and LINKS OUT (contentHtml null) — the listing has no full
		// body and the human page is gated behind a country/role selector + consent,
		// but this `.model.json` endpoint serves the records directly. `sortDate` is
		// epoch MILLISECONDS (not RFC-822), handled in the parser. Cembalest publishes
		// ~weekly/biweekly, so a daily poll is ample.
		source: 'eye-on-the-market',
		feed: 'https://am.jpmorgan.com/content/jpm-am-aem/global-institutional/us/en/institutional/insights/market-insights/eye-on-the-market/jcr:content/root/responsivegrid/jpm_am_container_sec/section/jpm_am_editorial_lan.model.json',
		pollIntervalSeconds: 86400,
		parse: parseJpmEotm,
		countRaw: countJpmEotm,
	},
	{
		// #339 — Mistral AI news, first-party RSS 2.0. The advertised /rss.xml URL
		// 301s to /news/rss (the news page's "RSS feed" card), so poll the final URL
		// directly. GOTCHA: it's served as `Content-Type: text/plain; charset=UTF-8`,
		// not an XML type — fine, run.ts never gates on content-type (it hands
		// res.text() straight to parse). Items are title+link with at most a
		// one-sentence teaser <description> (most items carry none), so `description`
		// mode yields a teaser-or-null contentHtml and we link out — the AMD pattern.
		// ~1–2 posts/week in an ~80-item window, so a 6-hour poll is ample. Fallback
		// mirrors if the first-party feed rots: the Turing Institute mirror
		// (raw.githubusercontent.com/alan-turing-institute/ai-rss-feeds → feeds/
		// mistral-news.xml), 0xSMW/rss-feeds (feed_mistral_news.xml, full text in
		// content:encoded), or the openrss.org proxy.
		source: 'mistral',
		feed: 'https://mistral.ai/news/rss',
		pollIntervalSeconds: 21600,
		parse: (xml) => parseRss20(xml, { content: 'description' }),
		countRaw: countRss20,
	},
	{
		// #337 — OpenAI's first-party news feed (the old /blog/rss.xml 307-redirects
		// here). RSS 2.0 with plain-text SUMMARIES in <description> — no
		// content:encoded, and article pages are Cloudflare-challenged for server
		// fetches, so we link out and never plan full-text enrichment. As with
		// Intel/ScienceDaily, `content:encoded` mode routes the description into
		// `summary` and leaves contentHtml null; ~9% of items (old case studies)
		// have no description at all, yielding a null summary. Items are NOT
		// strictly chronological — trust pubDate, never document order. `keep`
		// drops items published before OPENAI_LAUNCH_CUTOFF (first-poll flood
		// control against the full-archive feed); an item with a missing or
		// unparseable pubDate is KEPT — conservative, in the spirit of the AWS
		// rollout filter: rather ingest a stray archive item than drop a real
		// post (insertItems dedupes repeats by (source, guid) anyway). Most items
		// carry one <category> (Company/Research/Product/…, ~13% none); we
		// deliberately ingest ALL categories — a category filter can be added
		// later via this same `keep` seam. Several posts/week, so a 6-hour poll
		// is ample.
		source: 'openai',
		feed: 'https://openai.com/news/rss.xml',
		pollIntervalSeconds: 21600,
		parse: (xml) => parseRss20(xml, { content: 'content:encoded' }),
		countRaw: countRss20,
		keep: (item) => item.publishedAt === null || item.publishedAt >= OPENAI_LAUNCH_CUTOFF,
	},
	{
		// #333 — Acadian Asset Management "Owenomics" (Owen Lamont's behavioral
		// finance commentary). NO RSS/Atom exists anywhere on the site; the listing
		// page (/investment-insights/owenomics) is a server-rendered Sitecore shell
		// whose article cards load CLIENT-SIDE from this Sitecore results API — the
		// `data-endpoint` its search-results module declares (topic is the
		// Owenomics topic item's Sitecore GUID; site=acadian is the non-regional
		// site, whose records carry non-/au/ paths). Same "no feed, poll the
		// rendering data" family as TI (#30) and JPM EOTM (#319). Page 1 holds the
		// 20 newest of ~90 essays. parseOwenomics links out (the listing has no
		// teaser/body) and normalizes the MONTH-granularity `Date` ("August 2026")
		// to first-of-month UTC — the only machine-readable date in the payload,
		// and the same precision the article pages display. ~1–2 essays/month, so
		// a daily poll is ample. The endpoint serves our plain aggregator UA
		// (no anti-bot; confirmed in the #333 live probe).
		source: 'owenomics',
		feed: 'https://www.acadian-asset.com/api/sitecore/ResultsListingApi/GetArticlesByTopic?topic=%7BA2B2139C-F61B-4FA3-AFFB-02EDB2339234%7D&site=acadian',
		pollIntervalSeconds: 86400,
		parse: parseOwenomics,
		countRaw: countOwenomics,
	},
];
