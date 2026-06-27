import { describe, expect, it } from 'vitest';
import {
	countAtom,
	countAwsWhatsNew,
	countJpmEotm,
	countRss20,
	countTiNewsroom,
} from '../src/ingest/parse/count';
import cloudflareXml from './fixtures/cloudflare-blog.xml?raw';
import driftZeroXml from './fixtures/drift-zero-parsed.xml?raw';
import appleXml from './fixtures/apple.xml?raw';
import gravitonJson from './fixtures/aws-graviton.json?raw';
import tiNewsJson from './fixtures/ti-news-releases.json?raw';
import eotmJson from './fixtures/eye-on-the-market.json?raw';

// The counters report RAW container size, independent of parse keep/drop logic —
// they're the denominator the shape-drift check (#78) compares parsed count to.

describe('countRss20', () => {
	it('counts the <item> elements under channel', () => {
		expect(countRss20(cloudflareXml)).toBe(2);
	});

	it('counts items even when none will parse (the drift smoking gun)', () => {
		// The drift fixture has three <item>s with no guid/link; the parser keeps
		// none, but the RAW count is still three — that gap is the anomaly.
		expect(countRss20(driftZeroXml)).toBe(3);
	});

	it('returns 0 when the payload is not RSS (no rss > channel)', () => {
		// A format switch: parse() would already have thrown; the counter just
		// reports 0 raw entries, which is the correct (non-alarming) denominator.
		expect(countRss20('<feed xmlns="http://www.w3.org/2005/Atom"></feed>')).toBe(0);
	});

	it('counts a single <item> as one (array coercion)', () => {
		const one = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
			<item><guid>a</guid><link>https://x.test/a</link></item></channel></rss>`;
		expect(countRss20(one)).toBe(1);
	});

	it('returns 0 on malformed XML without throwing (#165)', () => {
		// A counter must never throw on a payload `parse` would reject; truncated XML
		// counts as 0 raw entries, the correct denominator.
		expect(countRss20('<![CDATA[')).toBe(0);
		expect(() => countRss20('<![CDATA[')).not.toThrow();
	});
});

describe('countAtom', () => {
	it('counts the <entry> elements under feed', () => {
		expect(countAtom(appleXml)).toBe(2);
	});

	it('returns 0 when the payload has no feed root', () => {
		expect(countAtom('<rss version="2.0"><channel></channel></rss>')).toBe(0);
	});

	it('returns 0 on malformed XML without throwing (#165)', () => {
		expect(countAtom('</item><item>')).toBe(0);
		expect(() => countAtom('</item><item>')).not.toThrow();
	});
});

describe('countAwsWhatsNew', () => {
	it('counts the top-level items array', () => {
		expect(countAwsWhatsNew(gravitonJson)).toBe(2);
	});

	it('returns 0 when items is missing', () => {
		expect(countAwsWhatsNew('{}')).toBe(0);
	});

	it('returns 0 on a non-object/garbage top level without throwing (#165)', () => {
		// JSON null, a bare number, and invalid JSON all count as 0 raw entries.
		expect(countAwsWhatsNew('null')).toBe(0);
		expect(countAwsWhatsNew('1')).toBe(0);
		expect(countAwsWhatsNew('{')).toBe(0);
		expect(() => countAwsWhatsNew('{')).not.toThrow();
	});
});

describe('countTiNewsroom', () => {
	it('counts records as array length minus the leading count header', () => {
		// element 0 is the total-count string; records follow.
		expect(countTiNewsroom(tiNewsJson)).toBe(3);
	});

	it('returns 0 for a non-array payload', () => {
		expect(countTiNewsroom('{}')).toBe(0);
	});

	it('never goes negative for an empty or header-only array', () => {
		expect(countTiNewsroom('[]')).toBe(0);
		expect(countTiNewsroom('["0"]')).toBe(0);
	});

	it('returns 0 on invalid JSON without throwing (#165)', () => {
		expect(countTiNewsroom('garbage')).toBe(0);
		expect(() => countTiNewsroom('garbage')).not.toThrow();
	});
});

describe('countJpmEotm', () => {
	it('counts the records in the pages array', () => {
		expect(countJpmEotm(eotmJson)).toBe(3);
	});

	it('returns 0 when pages is missing or not an array', () => {
		expect(countJpmEotm('{}')).toBe(0);
		expect(countJpmEotm('{"pages":{}}')).toBe(0);
	});

	it('returns 0 for a non-object/garbage top level without throwing (#165)', () => {
		// JSON null, an array, a bare number, and invalid JSON all count as 0.
		expect(countJpmEotm('null')).toBe(0);
		expect(countJpmEotm('[]')).toBe(0);
		expect(countJpmEotm('1')).toBe(0);
		expect(countJpmEotm('{')).toBe(0);
		expect(() => countJpmEotm('{')).not.toThrow();
	});
});
