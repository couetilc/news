import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { d1Query } from './d1';
import { AI_LAB_SOURCES } from '../src/ingest/ai-lab-sources';

const names = ['Google DeepMind', 'Ai2', 'Liquid AI', 'Sakana AI', 'Extropic', 'Normal Computing', 'Mythic', 'Grok / xAI', 'Physical Intelligence', 'World Labs'];
const articles = AI_LAB_SOURCES.map((feed, index) => {
	const extension = ['deepmind', 'ai2', 'sakana-ai', 'mythic'].includes(feed.source) ? 'xml' : 'html';
	const payload = readFileSync(new URL(`../test/fixtures/ai-labs/${feed.source}.${extension}`, import.meta.url), 'utf8');
	return { source: feed.source, name: names[index], ...feed.parse(payload).filter(feed.keep!)[0] };
});
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

test.use({ viewport: { width: 390, height: 844 } });
test.beforeEach(() => {
	for (const item of articles) d1Query(`INSERT INTO items (source, guid, url, title, published_at, fetched_at)
		VALUES (${quote(item.source)}, ${quote(item.guid)}, ${quote(item.url)}, ${quote(item.title)}, ${item.publishedAt}, 1789084800)`);
});

test('identifies all ten labs and filters each one to its canonical article', async ({ page }, testInfo) => {
	await page.goto('/signup');
	await page.getByLabel('Email').fill('connor@couetil.com');
	await page.getByLabel('Password').fill('correct-horse-battery');
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.waitForURL('**/');
	await page.locator('.source-filter summary').click();
	await page.screenshot({ path: testInfo.outputPath('ai-labs-phone.png'), fullPage: true });
	await page.setViewportSize({ width: 1200, height: 900 });
	await page.screenshot({ path: testInfo.outputPath('ai-labs-desktop.png'), fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	for (const article of articles) {
		await page.goto('/');
		await page.locator('.source-filter summary').click();
		await page.getByRole('navigation', { name: 'Filter by source' }).getByRole('link', { name: article.name, exact: true }).click();
		await expect(page).toHaveURL(new RegExp(`\\?source=${article.source}$`));
		const rows = page.locator('[data-feed-list] li[data-feed-row]');
		await expect(rows).toHaveCount(1);
		await expect(rows).toContainText(article.name);
		await expect(rows.getByRole('link', { name: article.title, exact: true })).toHaveAttribute('href', article.url);
		await expect(rows.locator('.mark')).toHaveAttribute('aria-hidden', 'true');
		await expect(rows.locator('.mark')).toHaveCSS('width', '10px');
		if (article.publishedAt === null) await expect(rows.locator('time')).toContainText('Added Sep 11, 2026');
	}
});
