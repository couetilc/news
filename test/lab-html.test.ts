import { describe, expect, it } from 'vitest';
import { article, articleUrl, calendarDate, countCards, dateInText, document, elements, hasClass, requireCards, text } from '../src/ingest/parse/lab-html';

describe('bounded HTML listing helpers', () => {
	it('walks document order, decodes entities, and excludes executable/style/comment text', () => {
		const doc = document('<!doctype html><!-- ignored --><h1>A &amp; <b>B</b></h1><script>bad()</script><style>bad</style><p class="one\t two"> C </p>');
		expect(text(doc)).toBe('A & B C');
		expect(text(undefined)).toBe('');
		expect(elements(doc, (n) => n.name === 'h1' || hasClass(n, 'two')).map(text)).toEqual(['A & B', 'C']);
		expect(elements(document('text'), () => true)).toEqual([]);
	});
	it('bounds adversarial nesting without call-stack overflow', () => {
		expect(() => document('<div>'.repeat(128))).not.toThrow();
		expect(() => document('<div>'.repeat(129))).toThrow('not an AI lab listing');
		const cards = (root: ReturnType<typeof document>) => elements(root, (n) => n.name === 'li');
		expect(countCards('<li>one</li><li>two</li>', cards)).toBe(2);
		expect(countCards('<div>'.repeat(20000), cards)).toBe(0);
		expect(() => requireCards('<p>no articles</p>', cards)).toThrow('not an AI lab listing');
		expect(requireCards('<li>one</li>', cards).map(text)).toEqual(['one']);
	});
	it.each(['2026-09-11', '9.11.2026', 'September 11, 2026'])('normalizes %s to UTC', (date) => {
		expect(calendarDate(date)).toBe(Date.UTC(2026, 8, 11) / 1000);
	});
	it('validates leap days and every named month independently of local time', () => {
		expect(calendarDate('2024-02-29')).toBe(Date.UTC(2024, 1, 29) / 1000);
		for (const [month, name] of 'January February March April May June July August September October November December'.split(' ').entries()) {
			expect(calendarDate(`${name} 1, 2026`)).toBe(Date.UTC(2026, month, 1) / 1000);
		}
	});
	it.each(['', '2026-02-30', '2026-13-01', '2026-01-00', '0026-01-01', 'February 29, 2026', '13.1.2026', '2026-09-11T12:00:00Z'])('rejects missing or invalid calendar date %s', (value) => {
		expect(() => calendarDate(value)).toThrow('not an AI lab listing');
	});
	it('extracts only an actual calendar date and preserves stable fragment identities', () => {
		expect(dateInText('Research September 11, 2026 Team')).toBe('September 11, 2026');
		expect(dateInText('September 2026')).toBe('');
		expect(article('/release?utm_source=x#model', 'Model', null, 'https://lab.example')).toEqual({
			guid: 'https://lab.example/release#model', url: 'https://lab.example/release#model', title: 'Model', publishedAt: null, summary: null, contentHtml: null,
		});
		expect(article('/model', 'Model', '2026-09-11', 'https://lab.example').publishedAt).toBe(1789084800);
		expect(articleUrl('http://lab.example/model', 'https://base.example')).toBe('http://lab.example/model');
	});
	it.each([undefined, '', 'http://[bad', 'javascript:alert(1)', 'data:text/html,bad', 'https://user@lab.example', 'https://:pass@lab.example'])('rejects unsafe/missing link %s', (url) => {
		expect(() => articleUrl(url, 'https://lab.example')).toThrow('not an AI lab listing');
	});
	it('rejects an empty title even with a valid URL', () => {
		expect(() => article('/model', '', null, 'https://lab.example')).toThrow('not an AI lab listing');
	});
});
