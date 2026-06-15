import { describe, expect, it } from 'vitest';
import { SOURCES } from '../src/ingest/sources';
import amdXml from './fixtures/amd.xml?raw';
import anthropicXml from './fixtures/anthropic.xml?raw';
import appleXml from './fixtures/apple.xml?raw';
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
