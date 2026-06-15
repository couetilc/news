import { describe, expect, it } from 'vitest';
import { SOURCES } from '../src/ingest/sources';
import amdXml from './fixtures/amd.xml?raw';
import appleXml from './fixtures/apple.xml?raw';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';
import ieeeXml from './fixtures/ieee-spectrum.xml?raw';
import intelXml from './fixtures/intel.xml?raw';
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
});
