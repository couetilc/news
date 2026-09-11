import { describe, expect, it } from 'vitest';
import { isArticleUrl } from '../src/lib/article-url';

describe('article URL boundary', () => {
	it.each(['https://example.com/a?q=b#heading', 'http://example.com/', 'HTTPS://EXAMPLE.COM/α', 'https://example.com/a%20b', 'https://example.com/Blog Post'])('accepts %s', (url) => {
		expect(isArticleUrl(url)).toBe(true);
	});
	it.each(['', '/relative', '//example.com', 'javascript:alert(1)', 'data:text/html,x', 'file:///tmp/a', 'https:example.com', 'https://', 'https://[bad', 'https://user@example.com', 'https://:pass@example.com', ' https://example.com', 'https://example.com\n', 'https://example.com/\u007f', 'https://example.com\\evil', 'java\tscript:alert(1)'])('rejects %j', (url) => {
		expect(isArticleUrl(url)).toBe(false);
	});
});
