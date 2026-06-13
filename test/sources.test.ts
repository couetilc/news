import { describe, expect, it } from 'vitest';
import { SOURCES } from '../src/ingest/sources';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';
import ieeeXml from './fixtures/ieee-spectrum.xml?raw';

const source = (name: string) => SOURCES.find((s) => s.source === name)!;

describe('SOURCES', () => {
	it('configures the two v1 sources', () => {
		expect(SOURCES.map((s) => s.source)).toEqual(['cloudflare-blog', 'ieee-spectrum']);
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
});
