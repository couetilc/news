import { describe, expect, it } from 'vitest';
import { countLiquid, countNormal, countPhysicalIntelligence, countWorldLabs, countXai, parseLiquid, parseNormal, parsePhysicalIntelligence, parseWorldLabs, parseXai } from '../src/ingest/parse/ai-labs';
import liquid from './fixtures/ai-labs/liquid-ai.html?raw';
import normal from './fixtures/ai-labs/normal-computing.html?raw';
import pi from './fixtures/ai-labs/physical-intelligence.html?raw';
import world from './fixtures/ai-labs/world-labs.html?raw';
import xai from './fixtures/ai-labs/xai.html?raw';

const listing = [
	[parseLiquid, countLiquid, liquid, 3, 'LFM2.5-DSpark: Up to 3.2x Faster Inference from H100 to MacBook', 'https://www.liquid.ai/blog/lfm2.5-dspark', 1787184000],
	[parseNormal, countNormal, normal, 3, 'CN101 - A Digital Thermodynamic Computer for Generative AI', 'https://arxiv.org/abs/2608.00754', 1786320000],
	[parsePhysicalIntelligence, countPhysicalIntelligence, pi, 3, 'π0.7: a Steerable Model with Emergent Capabilities', 'https://www.pi.website/blog/pi07', 1776297600],
	[parseWorldLabs, countWorldLabs, world, 4, 'Atlas: A World Model for Spatial Intelligence', 'https://www.worldlabs.ai/blog/atlas', 1788220800],
	[parseXai, countXai, xai, 9, 'grok-imagine-image-quality retirement on November 2', 'https://docs.x.ai/developers/release-notes#grok-imagine-image-quality-retirement-on-november-2', null],
] as const;

describe('official HTML lab listings', () => {
	it.each(listing)('extracts dated/linkable articles with %s', (parse, count, fixture, size, title, url, publishedAt) => {
		const items = parse(fixture);
		expect(count(fixture)).toBe(size);
		expect(items).toHaveLength(size);
		expect(items[0]).toEqual({ title, url, guid: url, publishedAt, summary: null, contentHtml: null });
	});
	it.each(listing)('%s fails visibly on wrong/missing structure', (parse, count) => {
		for (const bad of ['', '<h1>Access denied</h1>', '<a>broken', '<div>'.repeat(20000)]) {
			expect(() => parse(bad)).toThrow('not an AI lab listing');
			expect(count(bad)).toBe(0);
		}
	});
	it('Liquid reads the sibling date, skips its duplicate hero, and rejects broken cards', () => {
		expect(parseLiquid('<a href="/hero"><time datetime="2026-09-11"></time>Hero</a>' + liquid)).toHaveLength(3);
		for (const card of [
			'<li><time datetime="2026-09-11"></time></li>',
			'<li><time datetime="2026-09-11"></time><a>Model</a></li>',
			'<li><time></time><a href="/blog/model">Model</a></li>',
			'<li><time datetime="bad"></time><a href="/blog/model">Model</a></li>',
		]) {
			expect(countLiquid(card)).toBe(1);
			expect(() => parseLiquid(card)).toThrow('not an AI lab listing');
		}
	});
	it('Normal uses the visible link, not the hidden alternative or navigation filters', () => {
		expect(parseNormal(normal)[1].url).toBe('https://www.normalcomputing.com/blog/ai-inference-needs-new-hardware');
		expect(countNormal('<div role="listitem" class="nav-filter-txt">All</div>' + normal)).toBe(3);
		for (const field of ['item-title', 'item-eyebrow', 'link-abs']) {
			expect(() => parseNormal(normal.replaceAll(field, 'changed'))).toThrow('not an AI lab listing');
		}
	});
	it('PI requires the title attribute, and World Labs requires the actual card heading/date', () => {
		expect(() => parsePhysicalIntelligence('<a href="/blog/model">September 11, 2026</a>')).toThrow('not an AI lab listing');
		expect(() => parsePhysicalIntelligence(pi.replaceAll('title=', 'data-old-title='))).toThrow('not an AI lab listing');
		expect(() => parseWorldLabs('<a href="/blog/model"><h2>Model</h2></a>')).toThrow('not an AI lab listing');
		expect(() => parseWorldLabs('<a href="/blog/model">September 11, 2026</a>')).toThrow('not an AI lab listing');
	});
	it('xAI keeps the newest three month sections, including year boundaries, without invented dates', () => {
		const html = '<h3 id="intro">Ignore before a month</h3><h2>January 2027</h2><h3 id="one">One</h3><h2>December 2026</h2><h3 id="two">Two</h3><h2>November 2026</h2><h3 id="three">Three</h3><h2>October 2026</h2><h3 id="old">Old</h3>';
		expect(parseXai(html).map((i) => [i.title, i.publishedAt, i.url])).toEqual(['One', 'Two', 'Three'].map((title) => [title, null, `https://docs.x.ai/developers/release-notes#${title.toLowerCase()}`]));
		expect(countXai(html)).toBe(3);
		expect(parseXai('<h2>September</h2><h3 id="ok">OK</h3><h2>Appendix</h2><h3 id="other">Ignore</h3>')).toHaveLength(1);
		expect(() => parseXai('<h2>September</h2><h3>Missing anchor</h3>')).toThrow('not an AI lab listing');
		expect(() => parseXai('<h2>September</h2><h3 id="blank"></h3>')).toThrow('not an AI lab listing');
	});
});
