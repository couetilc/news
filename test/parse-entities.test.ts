import { describe, expect, it } from 'vitest';
import { decodeEntities, decodeText } from '../src/ingest/parse/entities';

// #224 — the shared HTML-entity decoder for the ingest parsers' plain-text
// fields (title/summary). These are direct unit assertions of the helper; the
// end-to-end decode through a real parser is asserted in parse-rss20.test.ts.

describe('decodeEntities — the four reference forms', () => {
	it('decodes a named reference (&amp; → &)', () => {
		expect(decodeEntities('Tom &amp; Jerry')).toBe('Tom & Jerry');
	});

	it('decodes a decimal numeric reference (&#039; → apostrophe)', () => {
		expect(decodeEntities('children&#039;s health')).toBe("children's health");
	});

	it('decodes a hex numeric reference (&#x27; → apostrophe)', () => {
		expect(decodeEntities('children&#x27;s health')).toBe("children's health");
	});

	it('resolves the double-encoded case (&amp;#039; → apostrophe) — the science-daily bug', () => {
		// The live science-daily payload is double-encoded: after the XML parser's
		// own decode the text still holds `&amp;#039;`. One pass yields `&#039;`; the
		// repeat-until-stable loop runs a second pass to reach the apostrophe.
		expect(decodeEntities('children&amp;#039;s mental health')).toBe(
			"children's mental health",
		);
		// A doubly-named double-encoding resolves the same way: &amp;amp; → &amp; → &.
		expect(decodeEntities('AT&amp;amp;T')).toBe('AT&T');
	});

	it('decodes the other named refs and is case-insensitive on the name', () => {
		expect(decodeEntities('a &lt; b &gt; c')).toBe('a < b > c');
		expect(decodeEntities('say &quot;hi&quot;')).toBe('say "hi"');
		expect(decodeEntities('it&apos;s')).toBe("it's");
		expect(decodeEntities('gap&nbsp;here')).toBe('gap here');
		expect(decodeEntities('&AMP; &Amp;')).toBe('& &');
	});
});

describe('decodeEntities — idempotent / lossless on already-plain text', () => {
	it('leaves plain text byte-for-byte unchanged (no entities present)', () => {
		const plain = 'Researchers map the brain circuit behind chronic pain';
		expect(decodeEntities(plain)).toBe(plain);
	});

	it('leaves a bare ampersand and an unknown/incomplete reference untouched', () => {
		// A `&` not forming a complete `&…;` reference is not an entity — keep it.
		expect(decodeEntities('Salt & pepper')).toBe('Salt & pepper');
		expect(decodeEntities('5 &lt 7')).toBe('5 &lt 7'); // no semicolon → not a ref
		expect(decodeEntities('an &unknownref; stays')).toBe('an &unknownref; stays');
		expect(decodeEntities('')).toBe('');
	});

	it('is idempotent — decoding an already-decoded value is a no-op', () => {
		const once = decodeEntities('children&amp;#039;s &amp; pets');
		expect(once).toBe("children's & pets");
		expect(decodeEntities(once)).toBe(once);
	});
});

describe('decodeEntities — out-of-range numeric refs degrade gracefully (#243)', () => {
	it('leaves an out-of-range HEX numeric ref verbatim without throwing', () => {
		// U+110000 is one past the max code point — String.fromCodePoint would throw
		// RangeError. The ref must survive untouched, like an unrecognized named ref.
		expect(() => decodeEntities('bad &#x110000; ref')).not.toThrow();
		expect(decodeEntities('bad &#x110000; ref')).toBe('bad &#x110000; ref');
	});

	it('leaves an out-of-range DECIMAL numeric ref verbatim without throwing', () => {
		expect(() => decodeEntities('bad &#9999999999; ref')).not.toThrow();
		expect(decodeEntities('bad &#9999999999; ref')).toBe('bad &#9999999999; ref');
	});

	it('decodes the max valid code point U+10FFFF — the boundary still works', () => {
		// 0x10FFFF is the last valid code point; it must decode, not be left verbatim.
		const max = String.fromCodePoint(0x10ffff);
		expect(decodeEntities('edge &#x10FFFF; case')).toBe(`edge ${max} case`);
		expect(decodeEntities('edge &#1114111; case')).toBe(`edge ${max} case`); // 0x10FFFF in decimal
	});

	it('leaves a bad ref verbatim while surrounding valid refs in the same string still decode', () => {
		// The one out-of-range ref must not poison the rest of the pass: the named &amp;
		// and the in-range numeric &#x27; on either side of it still resolve.
		expect(decodeEntities('Tom &amp; &#x110000; Jerry&#x27;s')).toBe("Tom & &#x110000; Jerry's");
	});
});

describe('decodeText — null passthrough for optional summary fields', () => {
	it('returns null unchanged (a missing summary stays null)', () => {
		expect(decodeText(null)).toBeNull();
	});

	it('decodes a non-null value exactly like decodeEntities', () => {
		expect(decodeText('Tips for parents &amp; grandparents')).toBe(
			'Tips for parents & grandparents',
		);
	});
});
