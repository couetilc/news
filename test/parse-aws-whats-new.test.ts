import { describe, expect, it } from 'vitest';
import { parseAwsWhatsNew } from '../src/ingest/parse/aws-whats-new';
import gravitonJson from './fixtures/aws-graviton.json?raw';

describe('parseAwsWhatsNew — Graviton query fixture', () => {
	const items = parseAwsWhatsNew(gravitonJson);

	it('extracts every item in response order', () => {
		expect(items.map((i) => i.title)).toEqual([
			'Amazon EC2 M9g and M9gd instances powered by AWS Graviton5 are now available',
			'AWS Nitro System enhancements for Graviton-based instances',
		]);
	});

	it('takes the full post body as content and keeps summary null', () => {
		expect(items[0].contentHtml).toBe(
			'<p>Starting today, Amazon EC2 M9g and M9gd general purpose instances powered by <strong>AWS Graviton5</strong> processors are generally available.</p>',
		);
		expect(items[0].summary).toBeNull();
	});

	it('uses the item id as guid (the stable cross-query dedupe key)', () => {
		expect(items[0].guid).toBe('whats-new-v2#launch-graviton5-m9g');
	});

	it('resolves a site-relative headlineUrl to an absolute URL', () => {
		expect(items[0].url).toBe(
			'https://aws.amazon.com/about-aws/whats-new/2026/06/ec2-m9g-m9gd-instances-graviton5-available/',
		);
	});

	it('leaves an already-absolute headlineUrl untouched', () => {
		expect(items[1].url).toBe(
			'https://aws.amazon.com/about-aws/whats-new/2026/06/nitro-graviton-networking/',
		);
	});

	it('parses the ISO-8601 postDateTime to unix seconds', () => {
		expect(items[0].publishedAt).toBe(Math.floor(Date.UTC(2026, 5, 10, 15, 0, 0) / 1000));
	});
});

describe('parseAwsWhatsNew — edge cases', () => {
	const wrap = (items: unknown[]) => JSON.stringify({ items });

	it('throws when the payload has no items array', () => {
		expect(() => parseAwsWhatsNew('{}')).toThrow(/not an AWS/);
	});

	it('skips a wrapper with no item record', () => {
		expect(parseAwsWhatsNew(wrap([{}]))).toEqual([]);
	});

	it('skips a record with no id (nothing stable to dedupe on)', () => {
		expect(
			parseAwsWhatsNew(wrap([{ item: { additionalFields: { headline: 'No id' } } }])),
		).toEqual([]);
	});

	it('falls back to the guid for url when headlineUrl is absent', () => {
		const [item] = parseAwsWhatsNew(wrap([{ item: { id: 'rec-1' } }]));
		expect(item.url).toBe('rec-1');
		expect(item.guid).toBe('rec-1');
	});

	it('defaults a missing headline to an empty string and null content/date', () => {
		const [item] = parseAwsWhatsNew(wrap([{ item: { id: 'rec-2', additionalFields: {} } }]));
		expect(item).toEqual({
			guid: 'rec-2',
			url: 'rec-2',
			title: '',
			summary: null,
			contentHtml: null,
			publishedAt: null,
		});
	});

	it('returns no items for an empty items array', () => {
		expect(parseAwsWhatsNew(wrap([]))).toEqual([]);
	});
});
