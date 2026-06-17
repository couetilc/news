import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseAtom, type AtomOptions } from '../src/ingest/parse/atom';
import { parseRss20, type Rss20Options } from '../src/ingest/parse/rss20';
import { parseAwsWhatsNew } from '../src/ingest/parse/aws-whats-new';
import { parseSecEdgar } from '../src/ingest/parse/sec-edgar';
import { parseTiNewsroom } from '../src/ingest/parse/ti-newsroom';
import { parseRfc822 } from '../src/ingest/parse/dates';
import {
	countAtom,
	countAwsWhatsNew,
	countRss20,
	countTiNewsroom,
} from '../src/ingest/parse/count';
import type { ParsedItem } from '../src/ingest/types';

// Fuzz the ingest parsers (#163) against arbitrary/malformed input. The contract
// (testing skill, "Testing the ingest parsers"): given arbitrary input a parser
// may throw ONLY its documented "not a … feed/response" guard — never a raw
// TypeError/RangeError/SyntaxError, never hang — and otherwise returns a
// well-formed ParsedItem[] (every field the right type). #165 hardened these
// parsers, so these are REGRESSION GUARDS and should PASS.
//
// Runs in the workers project (workerd) — the same pool that hosts the ingest
// unit tests. fast-check runs cleanly there. A fixed seed makes any
// counterexample reproducible. numRuns is bumped above the default so the
// generated XML/JSON space is explored harder.
const SEED = 0x163;
const RUNS = { seed: SEED, numRuns: 400 };

// Assert a value is a well-formed ParsedItem[] per src/ingest/types.ts: an array
// where every element has guid/url/title as strings, summary/contentHtml as
// string-or-null, and publishedAt as number-or-null. This is the positive half
// of the contract — a parser that doesn't throw must return THIS shape.
function expectWellFormed(items: ParsedItem[]): void {
	expect(Array.isArray(items)).toBe(true);
	for (const item of items) {
		expect(typeof item.guid).toBe('string');
		expect(typeof item.url).toBe('string');
		expect(typeof item.title).toBe('string');
		expect(item.summary === null || typeof item.summary === 'string').toBe(true);
		expect(item.contentHtml === null || typeof item.contentHtml === 'string').toBe(true);
		expect(item.publishedAt === null || typeof item.publishedAt === 'number').toBe(true);
		if (typeof item.publishedAt === 'number') {
			// Date.parse never yields NaN past the guard in parseRfc822, and it's
			// floored to an integer second.
			expect(Number.isNaN(item.publishedAt)).toBe(false);
			expect(Number.isInteger(item.publishedAt)).toBe(true);
		}
	}
}

// Run a parser under fuzz: it must either return a well-formed ParsedItem[] or
// throw an Error whose message matches the parser's documented guard. ANY other
// throw (raw TypeError/RangeError/SyntaxError, undocumented message) fails the
// property — that's the never-undocumented-throw half of the contract.
function fuzzParser(
	parse: (payload: string) => ParsedItem[],
	documentedGuard: RegExp,
	input: fc.Arbitrary<string>,
): void {
	fc.assert(
		fc.property(input, (payload) => {
			let items: ParsedItem[];
			try {
				items = parse(payload);
			} catch (err) {
				expect(err).toBeInstanceOf(Error);
				expect((err as Error).message).toMatch(documentedGuard);
				return; // documented rejection — contract satisfied
			}
			expectWellFormed(items);
		}),
		RUNS,
	);
}

// ── Input generators ────────────────────────────────────────────────────────
// Arbitrary bytes-as-text: the truly adversarial case (binary, control chars,
// truncated markup). Most of these hit the malformed-XML / invalid-JSON guard.
const arbitraryText = fc.string();

// Plausible-but-malformed JSON values rendered to strings, so the parsers'
// post-JSON.parse field logic (the deeper branches #165 hardened) is actually
// exercised, not just the SyntaxError guard. Includes null/array/object tops and
// junk array elements.
const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
	value: fc.oneof(
		{ depthSize: 'small' },
		fc.constant(null),
		fc.boolean(),
		fc.integer(),
		fc.string(),
		fc.array(tie('value'), { maxLength: 5 }),
		fc.dictionary(fc.string(), tie('value'), { maxKeys: 5 }),
	),
})).value;
const arbitraryJson = jsonValue.map((v) => JSON.stringify(v));

// XML-ish fragments: a mix of well-formed-looking tags, broken nesting, unclosed
// CDATA, and random text — to drive both the malformed-XML guard and the
// missing-root / per-entry-skip branches.
const xmlChunk = fc.oneof(
	fc.constantFrom(
		'<rss><channel>',
		'</channel></rss>',
		'<feed xmlns="http://www.w3.org/2005/Atom">',
		'</feed>',
		'<item>',
		'</item>',
		'<entry>',
		'</entry>',
		'<title>',
		'</title>',
		'<link href="x"/>',
		'<id>g</id>',
		'<guid>g</guid>',
		'<![CDATA[',
		']]>',
		'<pubDate>Tue, 10 Jun 2026 16:05:00 GMT</pubDate>',
		'<published>2026-06-10T16:05:00Z</published>',
		'&amp;',
		'<<>>',
	),
	fc.string(),
);
const arbitraryXml = fc.array(xmlChunk, { maxLength: 30 }).map((parts) => parts.join(''));

// AtomOptions / Rss20Options content modes — fuzz across every option so all
// summary/content routing branches are reachable under generated input.
const atomOpts: fc.Arbitrary<AtomOptions> = fc
	.constantFrom('content', 'summary', 'summary-only')
	.map((content) => ({ content }) as AtomOptions);
const rssOpts: fc.Arbitrary<Rss20Options> = fc
	.constantFrom('content:encoded', 'content', 'description')
	.map((content) => ({ content }) as Rss20Options);

describe('parseRss20 — fuzz (never throws undocumented, always well-formed)', () => {
	it('holds for arbitrary text and XML-ish input across all content modes', () => {
		fc.assert(
			fc.property(fc.oneof(arbitraryText, arbitraryXml), rssOpts, (payload, opts) => {
				let items: ParsedItem[];
				try {
					items = parseRss20(payload, opts);
				} catch (err) {
					expect(err).toBeInstanceOf(Error);
					expect((err as Error).message).toMatch(/^not an RSS 2\.0 feed/);
					return;
				}
				expectWellFormed(items);
			}),
			RUNS,
		);
	});
});

describe('parseAtom — fuzz (never throws undocumented, always well-formed)', () => {
	it('holds for arbitrary text and XML-ish input across all content modes', () => {
		fc.assert(
			fc.property(fc.oneof(arbitraryText, arbitraryXml), atomOpts, (payload, opts) => {
				let items: ParsedItem[];
				try {
					items = parseAtom(payload, opts);
				} catch (err) {
					expect(err).toBeInstanceOf(Error);
					expect((err as Error).message).toMatch(/^not an Atom feed/);
					return;
				}
				expectWellFormed(items);
			}),
			RUNS,
		);
	});
});

describe('parseAwsWhatsNew — fuzz (never throws undocumented, always well-formed)', () => {
	it('holds for arbitrary text and structured JSON input', () => {
		fuzzParser(
			parseAwsWhatsNew,
			/^not an AWS What.s New response/,
			fc.oneof(arbitraryText, arbitraryJson),
		);
	});
});

describe('parseTiNewsroom — fuzz (never throws undocumented, always well-formed)', () => {
	it('holds for arbitrary text and structured JSON input', () => {
		fuzzParser(
			parseTiNewsroom,
			/^not a TI newsroom response/,
			fc.oneof(arbitraryText, arbitraryJson),
		);
	});
});

describe('parseSecEdgar — fuzz (never throws undocumented, always well-formed)', () => {
	// SEC EDGAR takes options; fuzz the option surface too (forms/items filters,
	// the recent-window limit) alongside the payload so the columnar keep/drop and
	// early-exit branches are exercised under generated input.
	const opts = fc.record({
		cik: fc.stringMatching(/^[0-9]+$/).filter((s) => s.length > 0),
		issuer: fc.string(),
		forms: fc.option(fc.array(fc.constantFrom('8-K', '8-K/A', '10-K', '4'), { maxLength: 3 }), {
			nil: undefined,
		}),
		items: fc.option(fc.array(fc.constantFrom('2.02', '9.01', '5.02'), { maxLength: 3 }), {
			nil: undefined,
		}),
		limit: fc.option(fc.integer({ min: -5, max: 50 }), { nil: undefined }),
	});

	it('holds for arbitrary text and structured JSON input across option variants', () => {
		fc.assert(
			fc.property(fc.oneof(arbitraryText, arbitraryJson), opts, (payload, options) => {
				let items: ParsedItem[];
				try {
					items = parseSecEdgar(payload, options);
				} catch (err) {
					expect(err).toBeInstanceOf(Error);
					expect((err as Error).message).toMatch(/^not an EDGAR submissions response/);
					return;
				}
				expectWellFormed(items);
				// The recent-window cap (#79) must never be exceeded when set ≥ 0.
				if (typeof options.limit === 'number' && options.limit >= 0) {
					expect(items.length).toBeLessThanOrEqual(options.limit);
				}
			}),
			RUNS,
		);
	});
});

describe('raw counters — fuzz (never throw, always a non-negative integer)', () => {
	// The countRaw counters must NEVER throw on any payload (the FeedConfig
	// contract: parse runs first and surfaces the real error). Each returns the
	// raw entry count as a non-negative integer.
	const counters: ReadonlyArray<[string, (p: string) => number]> = [
		['countRss20', countRss20],
		['countAtom', countAtom],
		['countAwsWhatsNew', countAwsWhatsNew],
		['countTiNewsroom', countTiNewsroom],
	];
	for (const [name, count] of counters) {
		it(`${name} returns a non-negative integer and never throws`, () => {
			fc.assert(
				fc.property(fc.oneof(arbitraryText, arbitraryXml, arbitraryJson), (payload) => {
					const n = count(payload);
					expect(Number.isInteger(n)).toBe(true);
					expect(n).toBeGreaterThanOrEqual(0);
				}),
				RUNS,
			);
		});
	}
});

describe('parseRfc822 — fuzz (never throws, returns integer seconds or null)', () => {
	it('returns null or a finite integer for arbitrary input', () => {
		fc.assert(
			fc.property(
				fc.oneof(
					fc.string(),
					fc.constant(null),
					fc.constant(undefined),
					fc.date({ noInvalidDate: true }).map((d) => d.toISOString()),
				),
				(raw) => {
					const out = parseRfc822(raw);
					if (out === null) return;
					expect(Number.isInteger(out)).toBe(true);
					expect(Number.isNaN(out)).toBe(false);
				},
			),
			RUNS,
		);
	});

	it('round-trips a valid ISO-8601 instant to floored unix seconds', () => {
		fc.assert(
			fc.property(fc.date({ noInvalidDate: true }), (d) => {
				const expected = Math.floor(d.getTime() / 1000);
				expect(parseRfc822(d.toISOString())).toBe(expected);
			}),
			{ seed: SEED },
		);
	});
});
