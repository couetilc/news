import { describe, expect, it } from 'vitest';
import { SOURCES } from '../src/ingest/sources';
import amdXml from './fixtures/amd.xml?raw';
import anthropicXml from './fixtures/anthropic.xml?raw';
import appleXml from './fixtures/apple.xml?raw';
import gravitonJson from './fixtures/aws-graviton.json?raw';
import awsRolloutsJson from './fixtures/aws-rollouts.json?raw';
import ciscoXml from './fixtures/cisco.xml?raw';
import ciscoEdgarJson from './fixtures/cisco-sec-edgar.json?raw';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';
import deepseekXml from './fixtures/deepseek.xml?raw';
import elonlitXml from './fixtures/elonlit.xml?raw';
import ieeeXml from './fixtures/ieee-spectrum.xml?raw';
import intelXml from './fixtures/intel.xml?raw';
import mistralXml from './fixtures/mistral.xml?raw';
import nvidiaBlogXml from './fixtures/nvidia-blog.xml?raw';
import nvidiaNewsroomXml from './fixtures/nvidia-newsroom.xml?raw';
import openaiXml from './fixtures/openai.xml?raw';
import openModelsXml from './fixtures/open-models.xml?raw';
import qualcommXml from './fixtures/qualcomm.xml?raw';
import scienceDailyXml from './fixtures/science-daily.xml?raw';
import tiBlogJson from './fixtures/ti-company-blog.json?raw';
import tiNewsJson from './fixtures/ti-news-releases.json?raw';
import tiEdgarJson from './fixtures/ti-sec-edgar.json?raw';
import eotmJson from './fixtures/eye-on-the-market.json?raw';
import owenomicsJson from './fixtures/owenomics.json?raw';
import thinkingMachinesXml from './fixtures/thinking-machines.xml?raw';

const source = (name: string) => SOURCES.find((s) => s.source === name)!;

describe('SOURCES', () => {
	// Per-source presence checks (not an exact-list equality) so this stays green
	// as sibling PRs add more sources.
	it('includes each configured source', () => {
		const slugs = SOURCES.map((s) => s.source);
		expect(slugs).toContain('cloudflare-blog');
		expect(slugs).toContain('ieee-spectrum');
		expect(slugs).toContain('apple');
		expect(slugs).toContain('science-daily');
		expect(slugs).toContain('amd');
		expect(slugs).toContain('qualcomm');
		expect(slugs).toContain('intel');
		expect(slugs).toContain('nvidia');
		expect(slugs).toContain('elonlit');
		expect(slugs).toContain('anthropic');
		expect(slugs).toContain('aws');
		expect(slugs).toContain('cisco');
		expect(slugs).toContain('ti');
		expect(slugs).toContain('eye-on-the-market');
		expect(slugs).toContain('mistral');
		expect(slugs).toContain('openai');
		expect(slugs).toContain('thinking-machines');
		expect(slugs).toContain('owenomics');
		expect(slugs).toContain('open-models');
		expect(slugs).toContain('deepseek');
	});

	it('registers both Cisco feeds (IR RSS primary + EDGAR 8-K backstop) under one source', () => {
		const feeds = SOURCES.filter((s) => s.source === 'cisco').map((s) => s.feed);
		// Per-feed presence (not exact-list equality) so a sibling Cisco feed addition
		// won't break this. #71 moved the backstop onto the data.sec.gov JSON API.
		expect(feeds).toContain('https://investor.cisco.com/rss/pressrelease.aspx');
		expect(feeds).toContain('https://data.sec.gov/submissions/CIK0000858877.json');
	});

	it('parses the Cisco IR feed: title-only earnings PR, no content or summary', () => {
		const ir = SOURCES.find((s) => s.feed === 'https://investor.cisco.com/rss/pressrelease.aspx')!;
		const items = ir.parse(ciscoXml);
		expect(items[0].title).toBe('CISCO REPORTS THIRD QUARTER EARNINGS');
		expect(items[0].contentHtml).toBeNull();
		expect(items[0].summary).toBeNull();
	});

	it('parses the Cisco EDGAR feed: keeps Item 2.02 earnings 8-Ks, accession-number guids', () => {
		const edgar = SOURCES.find((s) => s.source === 'cisco' && s.feed.includes('sec.gov'))!;
		const items = edgar.parse(ciscoEdgarJson);
		expect(items.map((i) => i.guid)).toEqual([
			'0000858877-26-000075',
			'0000858877-26-000006',
		]);
		// The 2.02 earnings filing carries the "Results of Operations" label.
		expect(items[0].title).toContain('Results of Operations and Financial Condition');
	});

	it('registers all three Anthropic OpenRSS sections under one source', () => {
		const feeds = SOURCES.filter((s) => s.source === 'anthropic').map((s) => s.feed);
		expect(feeds).toEqual([
			'https://openrss.org/feed/www.anthropic.com/news',
			'https://openrss.org/feed/www.anthropic.com/research',
			'https://openrss.org/feed/www.anthropic.com/engineering',
		]);
		// 8h poll (3×/day): OpenRSS caches for 9h, so anything tighter just re-fetches.
		for (const s of SOURCES.filter((s) => s.source === 'anthropic')) {
			expect(s.pollIntervalSeconds).toBe(28800);
		}
	});

	it('parses Anthropic OpenRSS full HTML from the description, no summary', () => {
		// All three section feeds share the same parser closure, so exercise each
		// one (news/research/engineering) against the fixture — both to assert the
		// shared behavior and to cover every per-feed `parse` in SOURCES.
		for (const s of SOURCES.filter((s) => s.source === 'anthropic')) {
			const items = s.parse(anthropicXml);
			expect(items[0].title).toBe('Introducing Claude Fable 5 and Mythos 5');
			expect(items[0].url).toBe('https://www.anthropic.com/news/claude-fable-5-mythos-5');
			expect(items[0].contentHtml).toContain('<strong>frontier</strong>');
			expect(items[0].summary).toBeNull();
		}
	});

	it('configures one aws feed per silicon term, sharing source "aws"', () => {
		const aws = SOURCES.filter((s) => s.source === 'aws');
		// graviton/trainium/inferentia/nitro (#26).
		expect(aws).toHaveLength(4);
		const terms = aws.map((s) => new URL(s.feed).searchParams.get('q')).sort();
		expect(terms).toEqual(['graviton', 'inferentia', 'nitro', 'trainium']);
		// Distinct poll-state URLs (the feeds-table primary key) per term.
		expect(new Set(aws.map((s) => s.feed)).size).toBe(4);
	});

	it('parses an AWS What’s New JSON query: post body as content, absolute url, no summary', () => {
		const items = source('aws').parse(gravitonJson);
		expect(items[0].title).toBe(
			'Amazon EC2 M9g and M9gd instances powered by AWS Graviton5 are now available',
		);
		expect(items[0].contentHtml).toContain('AWS Graviton5');
		expect(items[0].summary).toBeNull();
		expect(items[0].url).toBe(
			'https://aws.amazon.com/about-aws/whats-new/2026/06/ec2-m9g-m9gd-instances-graviton5-available/',
		);
	});

	it('gives every aws term feed the region-rollout keep filter (#321)', () => {
		// The drop rule is SOURCE-WIDE: q= is full-text over the release body, so
		// every term (not just nitro/graviton) can surface region rollouts.
		for (const s of SOURCES.filter((s) => s.source === 'aws')) {
			expect(s.keep).toBeDefined();
			expect(s.keep!({
				guid: 'g',
				url: 'https://aws.amazon.com/x',
				title: 'Amazon EC2 R8g instances now available in additional regions',
				summary: null,
				contentHtml: null,
				publishedAt: null,
			})).toBe(false);
		}
	});

	it('aws keep filter drops "… available in <region(s)>" rollout headlines (#321)', () => {
		const aws = source('aws');
		const items = aws.parse(awsRolloutsJson);
		// The fixture carries all 12 sampled live headlines; parse keeps them all
		// (the filter is NOT the parser's job — run.ts applies `keep` post-anomaly).
		expect(items).toHaveLength(12);
		const dropped = items.filter((i) => !aws.keep!(i)).map((i) => i.title);
		expect(dropped).toEqual([
			'Amazon EC2 R8g instances now available in additional regions',
			'Amazon EC2 C7a instances are now available in the Asia Pacific (Singapore) Region',
			'Amazon EC2 C8in instances are now available in additional regions',
			'Amazon EC2 I8ge instances are now generally available in additional AWS regions',
			'AWS VPC Encryption Controls now available in AWS GovCloud (US) Regions',
		]);
	});

	it('aws keep filter preserves every genuine launch headline (#321)', () => {
		// The boundary the issue pins: "Introducing …" / "Announcing …" /
		// "launches …" / a first GA with NO region clause is the launch — kept.
		const aws = source('aws');
		const kept = aws.parse(awsRolloutsJson).filter((i) => aws.keep!(i)).map((i) => i.title);
		expect(kept).toEqual([
			'Announcing new Amazon EC2 M9g instances powered by AWS Graviton5 processors (Preview)',
			'Amazon Redshift launches RG instances powered by AWS Graviton',
			'Introducing Amazon EC2 C8in and C8ib instances',
			'Announcing Amazon EC2 Trn3 UltraServers for faster, lower-cost generative AI training',
			'Now generally available: Amazon EC2 M8gn and M8gb instances',
			// First GA — "now available" with no region clause stays in.
			'Amazon EC2 M9g and M9gd general purpose instances are now available',
			// "now available with …" (a software release), not "available in a region".
			'AWS Neuron SDK 2.30.0 now available with NKI 0.4.0 and expanded training support',
		]);
	});

	it('parses the Cloudflare blog from content:encoded with a separate summary', () => {
		const items = source('cloudflare-blog').parse(cloudflareXml);
		expect(items[0].contentHtml).toContain('<strong>markup</strong>');
		expect(items[0].summary).toBe('A short summary of the post.');
	});

	it('parses IEEE Spectrum full HTML from the description, no summary', () => {
		const items = source('ieee-spectrum').parse(ieeeXml);
		expect(items[0].contentHtml).toContain('Full article HTML');
		expect(items[0].summary).toBeNull();
	});

	it('parses Apple Newsroom Atom: <content> teaser as summary, links out, no body', () => {
		const items = source('apple').parse(appleXml);
		expect(items[0].title).toBe('Apple unveils innovative features across services');
		expect(items[0].summary).toContain('powerful new features');
		expect(items[0].contentHtml).toBeNull();
		expect(items[0].url).toBe(
			'https://www.apple.com/newsroom/2026/06/apple-unveils-innovative-features-across-services/',
		);
	});

	it('parses ScienceDaily summaries from the description, no content HTML', () => {
		const items = source('science-daily').parse(scienceDailyXml);
		expect(items[0].summary).toContain('neural circuit');
		expect(items[0].contentHtml).toBeNull();
	});

	it('parses AMD title-only IR releases (no content, no summary)', () => {
		const items = source('amd').parse(amdXml);
		expect(items[0].title).toBe('AMD Announces Next-Generation EPYC Processors');
		expect(items[0].contentHtml).toBeNull();
		expect(items[0].summary).toBeNull();
		// Two-digit-year pubDate resolves to 2026 (#24).
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 8, 13, 0, 0) / 1000));
	});

	it('parses Qualcomm full Business Wire HTML from the description, no summary', () => {
		const items = source('qualcomm').parse(qualcommXml);
		expect(items[0].contentHtml).toContain('BUSINESS WIRE');
		expect(items[0].summary).toBeNull();
	});

	it('parses Intel newsroom excerpts into summary, contentHtml null (link out for full text)', () => {
		const items = source('intel').parse(intelXml);
		expect(items[0].summary).toContain('Intel today announced a pilot network');
		expect(items[0].contentHtml).toBeNull();
	});

	it('parses the NVIDIA newsroom feed: full HTML from the bare <content>, description as summary', () => {
		// #25 — two `nvidia` feeds share the slug; target each by URL.
		const newsroom = SOURCES.find(
			(s) => s.feed === 'https://nvidianews.nvidia.com/releases.xml',
		)!;
		const items = newsroom.parse(nvidiaNewsroomXml);
		expect(items[0].contentHtml).toContain('<strong>next-generation</strong>');
		expect(items[0].summary).toBe(
			'NVIDIA today unveiled its next-generation GPU architecture.',
		);
	});

	it('parses the NVIDIA blog feed: full HTML from content:encoded, excerpt summary', () => {
		const blog = SOURCES.find((s) => s.feed === 'https://blogs.nvidia.com/feed/')!;
		const items = blog.parse(nvidiaBlogXml);
		expect(items[0].contentHtml).toContain('<strong>markup</strong>');
		expect(items[0].summary).toBe('A short WordPress excerpt of the post.');
	});

	it('parses the Elon Litman blog Atom feed: full HTML from <content>, excerpt summary', () => {
		const items = source('elonlit').parse(elonlitXml);
		expect(items[0].contentHtml).toContain('<strong>markup</strong>');
		expect(items[0].summary).toBe('<p>A short excerpt of the post.</p>');
	});

	it('registers all three TI feeds (news + blog newsroom API + EDGAR backstop) under one source (#30)', () => {
		const feeds = SOURCES.filter((s) => s.source === 'ti').map((s) => s.feed);
		// Per-feed presence (not exact-list equality) so a sibling TI feed addition
		// won't break this.
		expect(feeds).toContain(
			'https://www.ti.com/bin/ti/newsroom?page=1&lang=en-us&categories=none&years=none&type=news',
		);
		expect(feeds).toContain(
			'https://www.ti.com/bin/ti/newsroom?page=1&lang=en-us&categories=none&years=none&type=blog',
		);
		expect(feeds).toContain('https://data.sec.gov/submissions/CIK0000097476.json');
	});

	it('parses the TI news-releases API: headline as title, subheadline summary, links out (#30)', () => {
		const news = SOURCES.find((s) => s.source === 'ti' && s.feed.includes('type=news'))!;
		const items = news.parse(tiNewsJson);
		expect(items[0].title).toBe(
			"TI brings intelligence to battery management systems with industry's highest-cell-count EIS-enabled battery monitor",
		);
		expect(items[0].url).toContain('/about-ti/newsroom/news-releases/');
		expect(items[0].contentHtml).toBeNull();
	});

	it('parses the TI company-blog API with the same parser (#30)', () => {
		const blog = SOURCES.find((s) => s.source === 'ti' && s.feed.includes('type=blog'))!;
		const items = blog.parse(tiBlogJson);
		expect(items[0].title).toBe('Reliability will define the next decade of energy storage');
		expect(items[0].url).toContain('/about-ti/newsroom/company-blog/');
	});

	it('parses TI SEC EDGAR 8-K filings: synthesized title, links out, no body (#30)', () => {
		// Only 8-K/8-K/A current reports survive; periodic/ownership forms are dropped.
		const edgar = SOURCES.find((s) => s.source === 'ti' && s.feed.includes('sec.gov'))!;
		const items = edgar.parse(tiEdgarJson);
		expect(items[0].title).toBe(
			'Texas Instruments 8-K — Departure or Appointment of Directors or Officers',
		);
		expect(items[0].guid).toBe('0000950103-26-008325');
		expect(items[0].url).toBe(
			'https://www.sec.gov/Archives/edgar/data/97476/000095010326008325/dp247795_8k.htm',
		);
		expect(items[0].contentHtml).toBeNull();
	});

	it('registers the Eye on the Market source on the AEM editorial model.json endpoint (#319)', () => {
		const eotm = source('eye-on-the-market');
		expect(eotm.feed).toBe(
			'https://am.jpmorgan.com/content/jpm-am-aem/global-institutional/us/en/institutional/insights/market-insights/eye-on-the-market/jcr:content/root/responsivegrid/jpm_am_container_sec/section/jpm_am_editorial_lan.model.json',
		);
		// ~weekly/biweekly cadence → a daily poll is ample.
		expect(eotm.pollIntervalSeconds).toBe(86400);
		expect(eotm.countRaw).toBeDefined();
	});

	it('parses the Eye on the Market model.json: headline as title, teaser summary, links out (#319)', () => {
		const items = source('eye-on-the-market').parse(eotmJson);
		expect(items[0].title).toBe('Semiquincententacles');
		// Site-relative url resolved to an absolute am.jpmorgan.com article page.
		expect(items[0].url).toBe(
			'https://am.jpmorgan.com/us/en/asset-management/institutional/insights/market-insights/eye-on-the-market/semiquincententacles/',
		);
		// Link-out only: the listing carries a teaser, never the full essay.
		expect(items[0].summary).toMatch(/^Behold the Aquilaceph/);
		expect(items[0].contentHtml).toBeNull();
		// epoch-ms sortDate → unix seconds.
		expect(items[0].publishedAt).toBe(1782219660);
	});

	it('counts the Eye on the Market pages array as the drift denominator (#319)', () => {
		expect(source('eye-on-the-market').countRaw!(eotmJson)).toBe(3);
	});

	it('registers the Owenomics source on the Sitecore ResultsListingApi endpoint (#333)', () => {
		const owenomics = source('owenomics');
		// The listing PAGE is a server-rendered shell with no article cards; this
		// is the data-endpoint its search-results module loads them from
		// (non-regional site=acadian, so records carry non-/au/ paths).
		expect(owenomics.feed).toBe(
			'https://www.acadian-asset.com/api/sitecore/ResultsListingApi/GetArticlesByTopic?topic=%7BA2B2139C-F61B-4FA3-AFFB-02EDB2339234%7D&site=acadian',
		);
		// ~1–2 essays/month → a daily poll is ample.
		expect(owenomics.pollIntervalSeconds).toBe(86400);
		expect(owenomics.countRaw).toBeDefined();
	});

	it('parses the Owenomics listing API: title, absolute article URL, links out (#333)', () => {
		const items = source('owenomics').parse(owenomicsJson);
		expect(items[0].title).toBe('Crazy days in the stock market');
		// Site-relative Url resolved to the absolute non-regional article page.
		expect(items[0].url).toBe(
			'https://www.acadian-asset.com/investment-insights/owenomics/crazy-days-in-the-stock-market',
		);
		// Link-out only: the listing carries no teaser and no body.
		expect(items[0].summary).toBeNull();
		expect(items[0].contentHtml).toBeNull();
		// Month-granularity "August 2026" → first-of-month UTC.
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 1) / 1000));
	});

	it('counts the Owenomics Results array as the drift denominator (#333)', () => {
		expect(source('owenomics').countRaw!(owenomicsJson)).toBe(5);
	});

	it('registers the Mistral first-party feed on the /news/rss URL with a 6-hour poll (#339)', () => {
		const mistral = source('mistral');
		// The advertised /rss.xml 301s here; poll the final URL directly. The feed
		// is served as text/plain — run.ts parses by content, never content-type.
		expect(mistral.feed).toBe('https://mistral.ai/news/rss');
		// ~1–2 posts/week → 6-hourly.
		expect(mistral.pollIntervalSeconds).toBe(21600);
		expect(mistral.countRaw).toBeDefined();
	});

	it('parses Mistral title-only items: no content, no summary, links out (#339)', () => {
		// The newest live item has NO <description> at all — the AMD pattern:
		// `description` mode yields null contentHtml and the reader links out.
		const items = source('mistral').parse(mistralXml);
		expect(items[0].title).toBe('Mistral x HUMAIN');
		expect(items[0].url).toBe('https://mistral.ai/news/mistral-x-humain/');
		// guid mirrors the permalink (isPermaLink="true").
		expect(items[0].guid).toBe('https://mistral.ai/news/mistral-x-humain/');
		expect(items[0].contentHtml).toBeNull();
		expect(items[0].summary).toBeNull();
		// Precise second-resolution pubDate, RFC-822 GMT.
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 24, 16, 2, 41) / 1000));
	});

	it('parses a Mistral teaser description into contentHtml with no summary (#339)', () => {
		// When an item does carry a <description>, it's a one-sentence plain-text
		// teaser; `description` mode routes it into contentHtml and leaves summary
		// null (same path as IEEE Spectrum/Qualcomm).
		const items = source('mistral').parse(mistralXml);
		expect(items[1].title).toBe(
			'Agentic Search. More accurate and efficient results from your AI systems.',
		);
		expect(items[1].url).toBe('https://mistral.ai/news/agentic-search/');
		expect(items[1].contentHtml).toBe(
			'The retrieval layer that helps AI systems navigate, read, and verify information inside even the most complex documents',
		);
		expect(items[1].summary).toBeNull();
		expect(items[1].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 20, 12, 0, 17) / 1000));
	});

	it('counts every Mistral <item> as the drift denominator (#339)', () => {
		expect(source('mistral').countRaw!(mistralXml)).toBe(5);
	});

	it('registers the OpenAI first-party news feed (#337)', () => {
		const openai = source('openai');
		expect(openai.feed).toBe('https://openai.com/news/rss.xml');
		// Several posts/week → a 6-hour poll is ample.
		expect(openai.pollIntervalSeconds).toBe(21600);
		expect(openai.countRaw).toBeDefined();
		expect(openai.keep).toBeDefined();
	});

	it('parses the OpenAI feed: plain-text summary from the description, links out (#337)', () => {
		const items = source('openai').parse(openaiXml);
		expect(items).toHaveLength(8);
		expect(items[0].title).toBe('Our decision on Cursor following its acquisition by SpaceX');
		expect(items[0].url).toBe(
			'https://openai.com/index/our-decision-on-cursor-following-its-acquisition-by-spacex',
		);
		// guid isPermaLink="true" — the article URL is the stable dedupe id.
		expect(items[0].guid).toBe(items[0].url);
		// Summaries only: description → summary, no full text in the feed
		// (article pages are Cloudflare-challenged, so we link out).
		expect(items[0].summary).toBe(
			'Our decision to wind down our contract providing OpenAI models to Cursor following its acquisition by SpaceX.',
		);
		expect(items[0].contentHtml).toBeNull();
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 28, 6, 0, 0) / 1000));
		// ~9% of items (old case studies) carry no <description>: null summary,
		// still a well-formed item.
		const genebench = items.find((i) => i.title === 'Inside Genebench-Pro')!;
		expect(genebench.summary).toBeNull();
		expect(genebench.contentHtml).toBeNull();
	});

	it('preserves pubDate over document order for OpenAI (feed is not strictly chronological, #337)', () => {
		// Real live-feed quirk: the NVIDIA item precedes the Asana item in the
		// document even though Asana's pubDate is LATER — pubDate is the truth.
		const items = source('openai').parse(openaiXml);
		const nvidia = items.findIndex((i) => i.url === 'https://openai.com/index/nvidia/chatgpt-work');
		const asana = items.findIndex((i) => i.url === 'https://openai.com/index/asana');
		expect(nvidia).toBeLessThan(asana);
		expect(items[nvidia].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 18, 0, 0, 0) / 1000));
		expect(items[asana].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 18, 7, 0, 0) / 1000));
		expect(items[asana].publishedAt!).toBeGreaterThan(items[nvidia].publishedAt!);
	});

	it('openai keep filter drops pre-launch archive items, keeps post-cutoff ones (#337)', () => {
		// First-poll flood control: the live feed is the full ~1,157-item archive
		// back to 2015; only items published on/after 2026-08-01T00:00:00Z stay.
		// parse keeps everything (run.ts applies `keep` post-anomaly-check).
		const openai = source('openai');
		const items = openai.parse(openaiXml);
		expect(items).toHaveLength(8);
		const kept = items.filter((i) => openai.keep!(i)).map((i) => i.title);
		expect(kept).toEqual([
			'Our decision on Cursor following its acquisition by SpaceX',
			'Supporting Thailand’s next generation of AI startups',
			'How loveholidays is making everyone a builder with Codex',
			'How NVIDIA scales expertise with ChatGPT Work',
			'Asana cleared 5 years of engineering work in 2 weeks with Codex',
		]);
		const dropped = items.filter((i) => !openai.keep!(i)).map((i) => i.title);
		expect(dropped).toEqual([
			// 2026-07-29 — days before the cutoff; category (Research) is irrelevant
			// to keep: we ingest ALL categories, the cutoff is purely by date.
			'How enabling two settings tripled our scores on the ARC-AGI-3 benchmark',
			'Inside Genebench-Pro',
			'Introducing OpenAI',
		]);
	});

	it('openai keep filter keeps an item with a missing/unparseable pubDate (#337)', () => {
		// Conservative branch: rather ingest a stray archive item than drop a real
		// post whose date failed to parse (insertItems dedupes repeats anyway).
		expect(
			source('openai').keep!({
				guid: 'https://openai.com/index/undated',
				url: 'https://openai.com/index/undated',
				title: 'An undated post',
				summary: null,
				contentHtml: null,
				publishedAt: null,
			}),
		).toBe(true);
	});

	it('counts raw OpenAI <item> elements as the drift denominator (#337)', () => {
		// countRaw sees ALL 8 raw items — the keep filter must never shrink the
		// shape-drift comparison, or a mostly-archive poll would look like drift.
		expect(source('openai').countRaw!(openaiXml)).toBe(8);
	});

	it('registers Thinking Machines on the root feed with a daily poll (#338)', () => {
		const tm = source('thinking-machines');
		// The ROOT feed, not /blog/index.xml: same items today, but section-agnostic
		// (the site's declared rel=alternate), so future /news/ syndication would
		// land without a config change. /news/ has no working feed anywhere yet.
		expect(tm.feed).toBe('https://thinkingmachines.ai/index.xml');
		// ~1 post every 6 weeks → daily poll is ample.
		expect(tm.pollIntervalSeconds).toBe(86400);
		expect(tm.countRaw).toBeDefined();
		expect(tm.countRaw!(thinkingMachinesXml)).toBe(2);
	});

	it('parses Thinking Machines: full HTML from content:encoded, no summary (no description) (#338)', () => {
		const items = source('thinking-machines').parse(thinkingMachinesXml);
		expect(items).toHaveLength(2);
		expect(items[0].title).toBe('A Safe Path to Open Weights');
		// Permalink guid doubles as the absolute article URL.
		expect(items[0].url).toBe('https://thinkingmachines.ai/blog/a-safe-path-to-open-weights/');
		expect(items[0].guid).toBe('https://thinkingmachines.ai/blog/a-safe-path-to-open-weights/');
		// Full post HTML lives in content:encoded; items carry NO <description>,
		// so summary is null (not '').
		expect(items[0].contentHtml).toContain('<strong>Abstract:</strong>');
		expect(items[0].summary).toBeNull();
		// Date-only pubDate → midnight UTC, exactly.
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 6, 31, 0, 0, 0) / 1000));
		// The one item with a real time-of-day parses to that instant, not midnight.
		expect(items[1].title).toBe('Defeating Nondeterminism in LLM Inference');
		expect(items[1].publishedAt).toBe(Math.floor(Date.UTC(2025, 8, 10, 7, 1, 0) / 1000));
	});

	it('registers the open-models Hugging Face backstop feed (#340)', () => {
		const om = source('open-models');
		expect(om.feed).toBe('https://huggingface.co/blog/feed.xml');
		// Several posts/week feed-wide → a 6-hour poll is ample.
		expect(om.pollIntervalSeconds).toBe(21600);
		expect(om.countRaw).toBeDefined();
		expect(om.keep).toBeDefined();
	});

	it('parses HF blog title-only items: no summary, no content, links out (#340)', () => {
		// The live feed carries NO per-item <description> (only the channel-level
		// blog tagline), so `description` mode yields null on BOTH body slots —
		// the AMD title-only pattern; the reader links out.
		const items = source('open-models').parse(openModelsXml);
		expect(items).toHaveLength(9);
		expect(items[0].title).toBe('The Open ASR Leaderboard Adds Its First Global South Language');
		expect(items[0].url).toBe('https://huggingface.co/blog/open-asr-leaderboard-global-south');
		// guid mirrors the permalink (community posts mark isPermaLink="false"
		// but still carry the article URL as the guid text).
		expect(items[0].guid).toBe(items[0].url);
		expect(items[0].summary).toBeNull();
		expect(items[0].contentHtml).toBeNull();
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 28, 0, 0, 0) / 1000));
	});

	it('open-models keep filter keeps lab-name titles, incl. digit/hyphen-glued forms (#340)', () => {
		// The fixture's six lab titles are real HF headlines: the boundary rule
		// must match a lab token glued to a digit ("Qwen3-8B"), a hyphenated
		// version ("GLM-5.2", "DeepSeek-V4", "Qwen-3’s"), and a plain mention
		// ("MiniMax M2", quoted "DeepSeek"). parse keeps everything — run.ts
		// applies `keep` post-anomaly-check.
		const om = source('open-models');
		const kept = om.parse(openModelsXml).filter((i) => om.keep!(i)).map((i) => i.title);
		expect(kept).toEqual([
			'GLM-5.2: Built for Long-Horizon Tasks',
			'DeepSeek-V4: a million-token context that agents can actually use',
			'One Year Since the “DeepSeek Moment”',
			'Aligning to What? Rethinking Agent Generalization in MiniMax M2',
			'Accelerating Qwen3-8B Agent on Intel® Core™ Ultra with Depth-Pruned Draft Models',
			'The 4 Things Qwen-3’s Chat Template Teaches Us',
		]);
	});

	it('open-models keep filter drops non-lab titles and letter-glued near-misses (#340)', () => {
		// The false-positive guard: "Kimina-Prover-RL" contains "Kimi" glued to a
		// following letter and must NOT match; ordinary HF posts (other vendors'
		// models, platform news) are the bulk of the feed and must all drop.
		const om = source('open-models');
		const dropped = om.parse(openModelsXml).filter((i) => !om.keep!(i)).map((i) => i.title);
		expect(dropped).toEqual([
			'The Open ASR Leaderboard Adds Its First Global South Language',
			"Granite 4.2 LLMs: How They're Built",
			'Kimina-Prover-RL',
		]);
	});

	it('open-models keep filter handles tricky lab-name boundaries both ways (#340)', () => {
		// Constructed-title unit checks (the AWS constructed-item precedent) for
		// boundary forms the fixture can't carry — including the labs with no
		// live HF headline today (Kimi, Zhipu, Z.ai).
		const keep = source('open-models').keep!;
		const item = (title: string) => ({
			guid: 'g',
			url: 'https://huggingface.co/blog/x',
			title,
			summary: null,
			contentHtml: null,
			publishedAt: null,
		});
		// Lab tokens glued to digits/hyphens/punctuation stay matches…
		expect(keep(item('Qwen3-Coder is here'))).toBe(true);
		expect(keep(item('Kimi K2.5 sets a new agentic benchmark'))).toBe(true);
		expect(keep(item('GLM-5 technical report'))).toBe(true);
		expect(keep(item('Zhipu AI opens the GLM weights'))).toBe(true);
		expect(keep(item('Z.ai ships a long-horizon agent stack'))).toBe(true);
		expect(keep(item('MiniMax-M3 is out'))).toBe(true);
		// …case-insensitively ("Deepseek" is as common as "DeepSeek" on HF).
		expect(keep(item('Mini-R1: Reproduce Deepseek R1 „aha moment“ a RL tutorial'))).toBe(true);
		// …but a token glued to a LETTER on either side is a different word:
		expect(keep(item('Kimina-Prover: Test-time RL Search'))).toBe(false); // Kimi + "na"
		expect(keep(item('Fitting GLMs with scikit-learn'))).toBe(false); // statistics, plural
		expect(keep(item('How viz.ai uses transformers'))).toBe(false); // "vi" + z.ai
		// …and an unrelated title with no token at all drops.
		expect(keep(item('Universal Image Segmentation with Mask2Former and OneFormer'))).toBe(false);
	});

	it('counts every raw HF <item> as the drift denominator (#340)', () => {
		// countRaw sees ALL 9 raw items even though keep passes only 6 — the
		// filter must never shrink the shape-drift comparison, or a normal poll
		// of the mostly-off-topic feed would look like parse drift.
		const om = source('open-models');
		expect(om.countRaw!(openModelsXml)).toBe(9);
		expect(om.parse(openModelsXml).filter((i) => om.keep!(i)).length).toBeLessThan(9);
	});

	it('registers the deepseek OpenRSS proxy feed on the /feed/-prefixed URL (#340)', () => {
		const ds = source('deepseek');
		// EXACTLY the /feed/ form — the bare openrss.org/<host>/<path> URL serves
		// the OpenRSS HTML site page (probed 2026-08-30), not a feed.
		expect(ds.feed).toBe('https://openrss.org/feed/api-docs.deepseek.com/news');
		// OpenRSS serves a cached copy, so 3×/day like the Anthropic entries.
		expect(ds.pollIntervalSeconds).toBe(28800);
		expect(ds.countRaw).toBeDefined();
	});

	it('parses DeepSeek OpenRSS full page HTML from the description, no summary (#340)', () => {
		const items = source('deepseek').parse(deepseekXml);
		expect(items[0].title).toBe('Using the Anthropic API | DeepSeek API Docs');
		expect(items[0].url).toBe('https://api-docs.deepseek.com/guides/anthropic_api');
		// Permalink guid — the doc page URL is the stable dedupe id.
		expect(items[0].guid).toBe(items[0].url);
		// Full rendered-page HTML in the description CDATA → contentHtml, null
		// summary (the Anthropic OpenRSS path).
		expect(items[0].contentHtml).toContain('<code>https://api.deepseek.com/anthropic</code>');
		expect(items[0].summary).toBeNull();
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 7, 22, 7, 39, 58) / 1000));
	});

	it('counts every DeepSeek OpenRSS <item> as the drift denominator (#340)', () => {
		expect(source('deepseek').countRaw!(deepseekXml)).toBe(3);
	});
});
