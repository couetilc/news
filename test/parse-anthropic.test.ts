import { describe, expect, it } from 'vitest';
import { countAnthropic, parseAnthropic } from '../src/ingest/parse/anthropic';
import { SOURCES } from '../src/ingest/sources';
import { validateParse } from '../src/ingest/validate';
import news from './fixtures/anthropic-news.html?raw';
import research from './fixtures/anthropic-research.html?raw';

const card = (href = '/research/example', title = 'A &amp; B', date = 'Sep 10, 2026') =>
	`<a class="PublicationList-module__hash__listItem" href="${href}"><time>${date}</time><span class="PublicationList-module__hash__title">${title}</span></a>`;

describe('Anthropic official listings', () => {
	it.each([[news, 13], [research, 11]] as const)('counts unique cards, preserves dates and has no drift', (html, count) => {
		const items = parseAnthropic(html);
		expect(items).toHaveLength(count);
		expect(countAnthropic(html)).toBe(count);
		expect(validateParse({ rawCount: countAnthropic(html), items })).toBeNull();
		expect(items.every((i) => i.contentHtml === null && i.guid === i.url)).toBe(true);
		expect(items.some((i) => i.url.includes('/team/'))).toBe(false);
	});
	it('includes the missing September posts alongside featured-only cards without duplicates', () => {
		const items = parseAnthropic(research).filter((i) => i.publishedAt !== null);
		expect(items.map((i) => i.url.split('/').at(-1))).toEqual([
			'alignment-assessment-cybersecurity-incidents', 'formalizing-fermats-last-theorem', 'riemann-zeta',
			'Claude-accelerates-protein-design', 'intelligence-targeting-conventional-weapons-capabilities',
			'automated-researchers-mitigate-alignment-failures', 'enabling-independent-research', 'multiagent-systems',
			'reviewing-the-evidence-on-worker-retraining-programs', 'discovering-cryptographic-weaknesses',
		]);
		expect(items[0]).toMatchObject({ publishedAt: Date.UTC(2026, 8, 9) / 1000, summary: expect.stringContaining('alignment assessment of four incidents') });
		expect(items[4]).toMatchObject({ publishedAt: Date.UTC(2026, 8, 10) / 1000, summary: null });
	});
	it('includes the dated lead model release and off-section threat report, leaving the undated tool for the cutoff to exclude', () => {
		expect(parseAnthropic(news).slice(0, 2).map((i) => [i.url, i.title, i.publishedAt])).toEqual([
			['https://www.anthropic.com/claude-fable-and-mythos-5-1', 'Introducing Claude Fable 5.1 and Claude Mythos 5.1', Date.UTC(2026, 8, 1) / 1000],
			['https://www.anthropic.com/threat-intelligence-report-september-2026', 'Detecting and countering misuse of AI: September 2026', Date.UTC(2026, 8, 10) / 1000],
		]);
		expect(parseAnthropic(research)[0]).toMatchObject({ url: 'https://www.anthropic.com/institute/econ-scenarios', publishedAt: null });
	});
	it('decodes text and canonicalizes tracking, fragments and trailing slashes', () => {
		expect(parseAnthropic(card('/research/example/?utm_source=feed#top'))).toEqual([{
			guid: 'https://www.anthropic.com/research/example', url: 'https://www.anthropic.com/research/example',
			title: 'A & B', publishedAt: Date.UTC(2026, 8, 10) / 1000, summary: null, contentHtml: null,
		}]);
	});
	it.each(['', '<html>maintenance</html>', '<div>'.repeat(130), card('https://['), card('https://evil.test/research/example'),
		card('https://user:pass@www.anthropic.com/news/example'), card('http://www.anthropic.com/news/example'),
		card('/research/team/alignment'), card('/news/'), card('/'), card().replace(' href="/research/example"', ''),
		card('/research/example', ''), card('/research/example', 'Title', ''), card('/research/example', 'Title', 'Feb 30, 2026'),
		card().replace('<time>', '<div>').replace('</time>', '</div>'),
	])('rejects malformed listings/cards with a format error', (html) => {
		expect(() => parseAnthropic(html)).toThrow('not an AI lab listing');
	});
	it('counts malformed cards without depending on title/date extraction', () => {
		expect(countAnthropic(card('/research/example', '', ''))).toBe(1);
		expect(countAnthropic('<div>'.repeat(130))).toBe(0);
		expect(countAnthropic('<a href="/research/team/alignment">Team</a>')).toBe(0);
	});
	it('registers first-party loaders with bounded backfill and keeps engineering separate', () => {
		for (const section of ['news', 'research']) {
			const feed = SOURCES.find((s) => s.feed === `https://www.anthropic.com/${section}`)!;
			const fixture = section === 'news' ? news : research;
			expect(feed.parse(fixture)).toEqual(parseAnthropic(fixture));
			expect(feed.countRaw!(fixture)).toBe(countAnthropic(fixture));
			const item = parseAnthropic(card())[0];
			for (const [date, keep] of [[null, false], [Date.UTC(2026, 7, 1) / 1000 - 1, false], [Date.UTC(2026, 7, 1) / 1000, true]] as const) {
				expect(feed.keep!({ ...item, publishedAt: date })).toBe(keep);
			}
		}
	});
});
