import { describe, expect, it } from 'vitest';
import { SOURCES } from '../src/ingest/sources';
import amdXml from './fixtures/amd.xml?raw';
import anthropicXml from './fixtures/anthropic.xml?raw';
import appleXml from './fixtures/apple.xml?raw';
import gravitonJson from './fixtures/aws-graviton.json?raw';
import ciscoXml from './fixtures/cisco.xml?raw';
import ciscoEdgarJson from './fixtures/cisco-sec-edgar.json?raw';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';
import elonlitXml from './fixtures/elonlit.xml?raw';
import ieeeXml from './fixtures/ieee-spectrum.xml?raw';
import intelXml from './fixtures/intel.xml?raw';
import nvidiaBlogXml from './fixtures/nvidia-blog.xml?raw';
import nvidiaNewsroomXml from './fixtures/nvidia-newsroom.xml?raw';
import qualcommXml from './fixtures/qualcomm.xml?raw';
import scienceDailyXml from './fixtures/science-daily.xml?raw';
import tiBlogJson from './fixtures/ti-company-blog.json?raw';
import tiNewsJson from './fixtures/ti-news-releases.json?raw';
import tiEdgarJson from './fixtures/ti-sec-edgar.json?raw';
import eotmJson from './fixtures/eye-on-the-market.json?raw';

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
});
