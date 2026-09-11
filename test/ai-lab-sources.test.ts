import { describe, expect, it } from 'vitest';
import { AI_LAB_SOURCES } from '../src/ingest/ai-lab-sources';
import { SOURCES } from '../src/ingest/sources';
import { validateParse } from '../src/ingest/validate';
import deepmind from './fixtures/ai-labs/deepmind.xml?raw';
import ai2 from './fixtures/ai-labs/ai2.xml?raw';
import liquid from './fixtures/ai-labs/liquid-ai.html?raw';
import sakana from './fixtures/ai-labs/sakana-ai.xml?raw';
import extropic from './fixtures/ai-labs/extropic.html?raw';
import normal from './fixtures/ai-labs/normal-computing.html?raw';
import mythic from './fixtures/ai-labs/mythic.xml?raw';
import xai from './fixtures/ai-labs/xai.html?raw';
import pi from './fixtures/ai-labs/physical-intelligence.html?raw';
import world from './fixtures/ai-labs/world-labs.html?raw';

const cases = [
	['deepmind', 'https://deepmind.google/blog/rss.xml', deepmind, 4, 3, 21600],
	['ai2', 'https://allenai.org/rss.xml', ai2, 4, 3, 21600],
	['liquid-ai', 'https://www.liquid.ai/news/models', liquid, 3, 2, 21600],
	['sakana-ai', 'https://sakana.ai/feed.xml', sakana, 4, 1, 21600],
	['extropic', 'https://extropic.ai/writing', extropic, 12, 5, 86400],
	['normal-computing', 'https://www.normalcomputing.com/blog', normal, 3, 3, 86400],
	['mythic', 'https://www.mythic.ai/newsroom?format=rss', mythic, 4, 2, 86400],
	['xai', 'https://docs.x.ai/developers/release-notes', xai, 9, 8, 21600],
	['physical-intelligence', 'https://www.pi.website/blog', pi, 3, 3, 21600],
	['world-labs', 'https://www.worldlabs.ai/blog', world, 4, 3, 21600],
] as const;
const feed = (slug: string) => AI_LAB_SOURCES.find((s) => s.source === slug)!;
const item = { guid: 'fixture', url: 'https://lab.example/post', title: 'Grok: New thermodynamic inference hardware', publishedAt: 1789084800, summary: null, contentHtml: null };

describe('the ten approved AI lab sources', () => {
	it('registers exactly the checked selections in the running ingest configuration', () => {
		expect(AI_LAB_SOURCES.map((s) => s.source).sort()).toEqual(cases.map(([s]) => s).sort());
		for (const source of AI_LAB_SOURCES) expect(SOURCES.filter((s) => s.source === source.source)).toEqual([source]);
		expect(SOURCES.some((s) => /encharge|reflection/.test(s.source))).toBe(false);
	});
	it.each(cases)('%s uses its official channel with a bounded, healthy fixture backfill', (slug, url, payload, raw, kept, interval) => {
		const config = feed(slug);
		expect(config.feed).toBe(url);
		expect(config.pollIntervalSeconds).toBe(interval);
		expect(config.countRaw!(payload)).toBe(raw);
		const items = config.parse(payload);
		expect(items).toHaveLength(raw);
		expect(validateParse({ rawCount: raw, items })).toBeNull();
		expect(items.filter(config.keep!)).toHaveLength(kept);
		for (const article of items) expect(new URL(article.url).protocol).toBe('https:');
	});
	it('normalizes Sakana alternate links and keeps the English Fugu release only', () => {
		expect(feed('sakana-ai').parse(sakana).filter(feed('sakana-ai').keep!)).toMatchObject([{
			title: 'Introducing Fugu Max and Fugu Ultra v2: Orchestrating the Pareto Frontier',
			url: 'https://sakana.ai/fugu-max-release/', publishedAt: 1789052400,
		}]);
	});
	it('keeps feed summaries separate from full article content', () => {
		const xml = '<rss><channel><item><guid>g</guid><link>https://lab.example/post</link><title>Model</title><description>Short teaser</description><content:encoded><![CDATA[<p>Full body</p>]]></content:encoded></item></channel></rss>';
		for (const slug of ['deepmind', 'ai2', 'mythic']) {
			expect(feed(slug).parse(xml)[0]).toMatchObject({ summary: 'Short teaser', contentHtml: '<p>Full body</p>' });
		}
		const atom = '<feed><entry><id>g</id><link href="/model"/><title>Model</title><summary>Short teaser</summary><content type="html">&lt;p&gt;Full body&lt;/p&gt;</content></entry></feed>';
		expect(feed('sakana-ai').parse(atom)[0]).toMatchObject({ summary: 'Short teaser', contentHtml: '<p>Full body</p>' });
	});
	it('keeps Normal chip names without matching letter-only or letter-suffixed near misses', () => {
		expect(feed('normal-computing').keep!({ ...item, title: 'CN101 research paper' })).toBe(true);
		expect(feed('normal-computing').keep!({ ...item, title: 'CNabc company guide' })).toBe(false);
	});
	it('includes Grok model and voice updates with distinct fragment URLs and unknown dates', () => {
		const items = feed('xai').parse(xai).filter(feed('xai').keep!);
		expect(items.map((i) => i.title)).toContain('Grok Voice Think Fast 2.0 is available');
		expect(items.map((i) => i.title)).toContain('Grok 4.6');
		expect(new Set(items.map((i) => i.url)).size).toBe(8);
		expect(items.every((i) => i.publishedAt === null)).toBe(true);
	});
	it.each([
		['deepmind', 7], ['ai2', 7], ['liquid-ai', 7], ['sakana-ai', 7], ['extropic', 6],
		['normal-computing', 5], ['mythic', 0], ['physical-intelligence', 0], ['world-labs', 5],
	] as const)('%s keeps the cutoff boundary, future and undated releases without importing older history', (slug, month) => {
		const cutoff = Date.UTC(2026, month, 1) / 1000;
		const keep = feed(slug).keep!;
		expect(keep({ ...item, publishedAt: cutoff - 1 })).toBe(false);
		expect(keep({ ...item, publishedAt: cutoff })).toBe(true);
		expect(keep({ ...item, publishedAt: null })).toBe(true);
		expect(keep({ ...item, publishedAt: Date.UTC(2027, 0, 1) / 1000 })).toBe(true);
	});
	it.each([
		['sakana-ai', 'Fuguを公開'], ['sakana-ai', 'New partnership'], ['sakana-ai', 'New investment'], ['sakana-ai', 'Sakana raises funding'],
		['normal-computing', 'EDA workflow guide'], ['normal-computing', 'Hardware funding round'],
		['mythic', 'Mythic appoints a CEO'], ['world-labs', 'World Labs announces funding'],
		['world-labs', 'World Labs Acquires Scenica'], ['physical-intelligence', 'New partnership'],
		['xai', 'Priority processing'], ['xai', 'Grok 4.5 available in the EU'],
	])('%s excludes editorial noise: %s', (slug, title) => {
		expect(feed(slug).keep!({ ...item, title })).toBe(false);
	});
});
