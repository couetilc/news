import { describe, expect, it } from 'vitest';
import { parseRss20 } from '../src/ingest/parse/rss20';
import amdXml from './fixtures/amd.xml?raw';
import anthropicXml from './fixtures/anthropic.xml?raw';
import ciscoXml from './fixtures/cisco.xml?raw';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';
import ieeeXml from './fixtures/ieee-spectrum.xml?raw';
import intelXml from './fixtures/intel.xml?raw';
import nvidiaNewsroomXml from './fixtures/nvidia-newsroom.xml?raw';
import qualcommXml from './fixtures/qualcomm.xml?raw';
import scienceDailyXml from './fixtures/science-daily.xml?raw';

describe('parseRss20 — content:encoded mode (Cloudflare blog)', () => {
	const items = parseRss20(cloudflareXml, { content: 'content:encoded' });

	it('extracts every item in feed order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'Making Workers even faster',
			'Introducing D1 vector search',
		]);
	});

	it('takes content from content:encoded and summary from description', () => {
		expect(items[0].contentHtml).toBe(
			'<p>The full HTML body of the post, with <strong>markup</strong>.</p>',
		);
		expect(items[0].summary).toBe('A short summary of the post.');
	});

	it('normalizes guid, url, and published date', () => {
		expect(items[0].guid).toBe('https://blog.cloudflare.com/making-workers-faster/');
		expect(items[0].url).toBe('https://blog.cloudflare.com/making-workers-faster/');
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 12, 14, 0, 0) / 1000));
	});
});

describe('parseRss20 — description mode (IEEE Spectrum)', () => {
	const items = parseRss20(ieeeXml, { content: 'description' });

	it('takes full HTML from the CDATA description and leaves summary null', () => {
		expect(items[0].contentHtml).toBe(
			'<p>Full article HTML for the chip story, kilobytes in reality.</p>',
		);
		expect(items[0].summary).toBeNull();
	});

	it('preserves feed order including the stale 2022 tail item (sorting is the DB layer’s job)', () => {
		expect(items).toHaveLength(3);
		expect(items[2].publishedAt).toBe(Math.floor(Date.UTC(2022, 0, 3, 15, 0, 0) / 1000));
	});
});

describe('parseRss20 — summaries-only mode (ScienceDaily)', () => {
	// #21: ScienceDaily's all.xml carries the rewritten press-release summary in
	// <description> and ships no content:encoded, so the content:encoded option
	// keeps the description as the summary and leaves contentHtml null.
	const items = parseRss20(scienceDailyXml, { content: 'content:encoded' });

	it('extracts every item in feed order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'Researchers map the brain circuit behind chronic pain',
			'New catalyst turns captured carbon dioxide into jet fuel',
			'Distant exoplanet shows signs of a water-rich atmosphere',
		]);
	});

	it('keeps the description as the summary and leaves contentHtml null', () => {
		expect(items[0].summary).toMatch(/^Scientists have identified a specific neural circuit/);
		expect(items[0].summary).not.toBeNull();
		expect(items[0].contentHtml).toBeNull();
	});

	it('normalizes guid, url, and published date from the non-permalink guid', () => {
		expect(items[0].guid).toBe(
			'https://www.sciencedaily.com/releases/2026/06/260612101500.htm',
		);
		expect(items[0].url).toBe(
			'https://www.sciencedaily.com/releases/2026/06/260612101500.htm',
		);
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 12, 14, 15, 0) / 1000));
	});
});

describe('parseRss20 — AMD IR press releases (titles only, two-digit-year dates)', () => {
	const items = parseRss20(amdXml, { content: 'description' });

	it('parses a title-only item: title and url set, content and summary null', () => {
		expect(items[0]).toEqual({
			guid: 'https://ir.amd.com/news-events/press-releases/detail/1234/amd-epyc',
			url: 'https://ir.amd.com/news-events/press-releases/detail/1234/amd-epyc',
			title: 'AMD Announces Next-Generation EPYC Processors',
			summary: null,
			contentHtml: null,
			publishedAt: Math.floor(Date.UTC(2026, 5, 8, 13, 0, 0) / 1000),
		});
	});

	it('parses the two-digit-year pubDate as 2026, not 0026 (acceptance criterion)', () => {
		// "Tue, 28 Apr 26 20:05:00 GMT" → 2026, the year-window gotcha from #24.
		expect(items[1].publishedAt).toBe(Math.floor(Date.UTC(2026, 3, 28, 20, 5, 0) / 1000));
	});
});

describe('parseRss20 — description mode (Qualcomm Q4 Inc IR feed)', () => {
	const items = parseRss20(qualcommXml, { content: 'description' });

	it('extracts every press release in feed order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'Qualcomm Announces Fourth Quarter and Fiscal 2026 Results',
			'Qualcomm Unveils Next-Generation Snapdragon Platform at CES 2026',
		]);
	});

	it('takes full Business Wire HTML from the description and leaves summary null', () => {
		expect(items[0]).toEqual({
			guid: 'https://investor.qualcomm.com/news-events/press-releases/detail/2026/Qualcomm-Announces-Fourth-Quarter-Results',
			url: 'https://investor.qualcomm.com/news-events/press-releases/detail/2026/Qualcomm-Announces-Fourth-Quarter-Results',
			title: 'Qualcomm Announces Fourth Quarter and Fiscal 2026 Results',
			summary: null,
			contentHtml:
				'<p>SAN DIEGO--(BUSINESS WIRE)--Qualcomm Incorporated (NASDAQ: QCOM) today announced <strong>results</strong> for its fourth quarter and fiscal 2026.</p><p>Full Business Wire HTML body, kilobytes in reality.</p>',
			publishedAt: Math.floor(Date.UTC(2026, 1, 4, 21, 5, 0) / 1000),
		});
	});

	it('carries product PRs (e.g. the CES Snapdragon announcement) alongside financial ones', () => {
		expect(items[1].contentHtml).toContain('CES 2026');
		expect(items[1].summary).toBeNull();
	});
});

describe('parseRss20 — description mode (Cisco IR feed, titles only, #31)', () => {
	const items = parseRss20(ciscoXml, { content: 'description' });

	it('extracts every press release in feed order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'CISCO REPORTS THIRD QUARTER EARNINGS',
			'Cisco Schedules Conference Call for Q3 FY2026 Financial Results',
			'Cisco Unveils Agentic Platform for Operating and Defending Critical IT Infrastructure',
		]);
	});

	it('parses a title-only earnings PR: empty description → null content and summary', () => {
		expect(items[0]).toEqual({
			guid: '2a357c7d-9808-425d-9cb6-74e2646e40e3',
			url: 'https://investor.cisco.com/news/news-details/2026/CISCO-REPORTS-THIRD-QUARTER-EARNINGS/default.aspx',
			title: 'CISCO REPORTS THIRD QUARTER EARNINGS',
			summary: null,
			contentHtml: null,
			// pubDate carries a numeric offset (-0400) → 20:05:00Z.
			publishedAt: Math.floor(Date.UTC(2026, 4, 13, 20, 5, 0) / 1000),
		});
	});

	it('carries the "Schedules Conference Call" PR that drives the burst-poll window', () => {
		expect(items[1].title).toMatch(/Schedules Conference Call/i);
	});

	it('matches the earnings PR with the issue’s /REPORTS .* QUARTER EARNINGS/i pattern', () => {
		expect(items[0].title).toMatch(/REPORTS .* QUARTER EARNINGS/i);
	});
});

describe('parseRss20 — content:encoded mode, excerpt-only WordPress feed (Intel newsroom)', () => {
	const items = parseRss20(intelXml, { content: 'content:encoded' });

	it('extracts every item in feed order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'New Smart City Pilot Network to Bridge Digital Divide for 50 U.S. Cities',
			'Intel Foundry Adds Two New Customers to Advanced Packaging Program',
		]);
	});

	it('routes the description excerpt into summary and leaves contentHtml null (no full text)', () => {
		expect(items[0].summary).toContain('Intel today announced a pilot network');
		expect(items[0].contentHtml).toBeNull();
	});

	it('normalizes guid (isPermaLink="false"), url from link, and the +0000 published date', () => {
		expect(items[0].guid).toBe('https://newsroom.intel.com/?p=104321');
		expect(items[0].url).toBe('https://newsroom.intel.com/5g-wireless/smart-city-pilot-network');
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 9, 15, 0, 54) / 1000));
	});
});

describe('parseRss20 — bare <content> mode (NVIDIA newsroom, #25)', () => {
	// #25 acceptance criterion: NVIDIA's iPressroom feed carries the FULL release
	// text in a NONSTANDARD bare <content> element (escaped CDATA), not
	// content:encoded. `'content'` mode reads <content> as the body and keeps the
	// <description> as the summary.
	const items = parseRss20(nvidiaNewsroomXml, { content: 'content' });

	it('extracts every item in feed order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'NVIDIA Announces Next-Generation GPU Architecture',
			'NVIDIA Sets GTC 2026 Keynote Date',
		]);
	});

	it('takes full HTML from the bare <content> element and the summary from description', () => {
		expect(items[0].contentHtml).toBe(
			'<p>NVIDIA today unveiled its <strong>next-generation</strong> GPU architecture, delivering record performance for AI workloads.</p><p>The full press-release HTML body, kilobytes in reality.</p>',
		);
		expect(items[0].summary).toBe('NVIDIA today unveiled its next-generation GPU architecture.');
	});

	it('normalizes guid, url, and published date', () => {
		expect(items[0].guid).toBe(
			'https://nvidianews.nvidia.com/news/nvidia-announces-next-generation-gpu-architecture',
		);
		expect(items[0].url).toBe(
			'https://nvidianews.nvidia.com/news/nvidia-announces-next-generation-gpu-architecture',
		);
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 12, 13, 0, 0) / 1000));
	});
});

describe('parseRss20 — description mode (Anthropic via OpenRSS proxy)', () => {
	// #22: OpenRSS mirrors each Anthropic section as RSS 2.0 with namespaced root
	// (content/dc/ofeed) and the full rendered article HTML in the <description>
	// CDATA — no content:encoded — so `description` mode routes it to contentHtml.
	const items = parseRss20(anthropicXml, { content: 'description' });

	it('extracts every item in feed order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'Introducing Claude Fable 5 and Mythos 5',
			'Expanding the Economic Index',
		]);
	});

	it('takes the full HTML from the CDATA description and leaves summary null', () => {
		expect(items[0]).toEqual({
			guid: 'https://www.anthropic.com/news/claude-fable-5-mythos-5',
			url: 'https://www.anthropic.com/news/claude-fable-5-mythos-5',
			title: 'Introducing Claude Fable 5 and Mythos 5',
			summary: null,
			contentHtml:
				'<article><h1>Introducing Claude Fable 5 and Mythos 5</h1><p>Today we are announcing our most capable models yet, with <strong>frontier</strong> performance across coding and agentic tasks.</p></article>',
			publishedAt: Math.floor(Date.UTC(2026, 5, 9, 16, 0, 0) / 1000),
		});
	});
});

describe('parseRss20 — edge cases', () => {
	const wrap = (inner: string) =>
		`<?xml version="1.0"?><rss version="2.0"><channel>${inner}</channel></rss>`;

	it('falls back to link when an item has no guid', () => {
		const [item] = parseRss20(
			wrap('<item><title>T</title><link>https://e.com/a</link></item>'),
			{ content: 'description' },
		);
		expect(item.guid).toBe('https://e.com/a');
		expect(item.url).toBe('https://e.com/a');
	});

	it('skips an item with neither guid nor link', () => {
		const items = parseRss20(wrap('<item><title>orphan</title></item>'), {
			content: 'description',
		});
		expect(items).toEqual([]);
	});

	it('defaults a missing title to an empty string', () => {
		const [item] = parseRss20(wrap('<item><guid>g1</guid></item>'), {
			content: 'description',
		});
		expect(item.title).toBe('');
	});

	it('keeps a numeric-looking guid as a string', () => {
		const [item] = parseRss20(wrap('<item><guid>123456</guid></item>'), {
			content: 'description',
		});
		expect(item.guid).toBe('123456');
	});

	it('yields an array for a single-item channel', () => {
		const items = parseRss20(wrap('<item><guid>only</guid></item>'), {
			content: 'description',
		});
		expect(Array.isArray(items)).toBe(true);
		expect(items).toHaveLength(1);
	});

	it('returns no items for a channel that has metadata but no entries', () => {
		expect(parseRss20(wrap('<title>Empty feed</title>'), { content: 'description' })).toEqual(
			[],
		);
	});

	it('leaves contentHtml null when content:encoded is absent', () => {
		const [item] = parseRss20(wrap('<item><guid>g</guid></item>'), {
			content: 'content:encoded',
		});
		expect(item.contentHtml).toBeNull();
	});

	it('leaves contentHtml null when the bare <content> element is absent', () => {
		const [item] = parseRss20(wrap('<item><guid>g</guid></item>'), {
			content: 'content',
		});
		expect(item.contentHtml).toBeNull();
	});

	it('throws on a payload that is not an RSS 2.0 feed', () => {
		expect(() => parseRss20('<feed><entry/></feed>', { content: 'description' })).toThrow(
			/not an RSS 2.0 feed/,
		);
	});

	// #165 (fuzz-found): truncated/malformed XML made fast-xml-parser throw its own
	// internal error ("CDATA is not closed", or a TypeError on bad nesting) instead
	// of the documented rejection. Each must surface as "not an RSS 2.0 feed", never
	// an undocumented runtime error.
	it('rejects a truncated CDATA payload with the documented error (no raw parser error)', () => {
		expect(() => parseRss20('<![CDATA[', { content: 'description' })).toThrow(
			/not an RSS 2.0 feed: malformed XML/,
		);
		expect(() => parseRss20('<![CDATA[', { content: 'description' })).not.toThrow(/CDATA/);
	});

	it('rejects malformed tag nesting with the documented error (no TypeError)', () => {
		expect(() => parseRss20('</item><item>', { content: 'description' })).toThrow(
			/not an RSS 2.0 feed/,
		);
		expect(() => parseRss20('</item><item>', { content: 'description' })).not.toThrow(TypeError);
	});

	it('rejects an empty payload with the documented error', () => {
		expect(() => parseRss20('', { content: 'description' })).toThrow(/not an RSS 2.0 feed/);
	});
});
