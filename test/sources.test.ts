import { describe, expect, it } from 'vitest';
import { SOURCES } from '../src/ingest/sources';
import amdXml from './fixtures/amd.xml?raw';
import anthropicXml from './fixtures/anthropic.xml?raw';
import appleXml from './fixtures/apple.xml?raw';
import gravitonJson from './fixtures/aws-graviton.json?raw';
import ciscoXml from './fixtures/cisco.xml?raw';
import ciscoEdgarXml from './fixtures/cisco-edgar-8k.xml?raw';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';
import elonlitXml from './fixtures/elonlit.xml?raw';
import ieeeXml from './fixtures/ieee-spectrum.xml?raw';
import intelXml from './fixtures/intel.xml?raw';
import nvidiaBlogXml from './fixtures/nvidia-blog.xml?raw';
import nvidiaNewsroomXml from './fixtures/nvidia-newsroom.xml?raw';
import qualcommXml from './fixtures/qualcomm.xml?raw';
import scienceDailyXml from './fixtures/science-daily.xml?raw';

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
	});

	it('registers both Cisco feeds (IR RSS primary + EDGAR 8-K backstop) under one source', () => {
		const feeds = SOURCES.filter((s) => s.source === 'cisco').map((s) => s.feed);
		expect(feeds).toEqual([
			'https://investor.cisco.com/rss/pressrelease.aspx',
			'https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000858877&type=8-K&output=atom&count=10',
		]);
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
		const items = edgar.parse(ciscoEdgarXml);
		expect(items.map((i) => i.guid)).toEqual([
			'0000858877-26-000075',
			'0000858877-26-000006',
		]);
		expect(items[0].title).toContain('Item 2.02');
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
});
