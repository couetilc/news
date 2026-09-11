import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import { d1Query } from './d1';
import { SOURCES } from '../src/ingest/sources';

// Red -> green: without the metadata registration, the real UI shows the raw
// inception-labs slug and a neutral square. Seed the actual parser's output,
// including responsive duplicates, so filtering links to the official release.
const feed = SOURCES.find((source) => source.source === 'inception-labs')!;
const payload = readFileSync(new URL('../test/fixtures/inception-blog.html', import.meta.url), 'utf8');
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

test.use({ viewport: { width: 390, height: 844 } });

test.beforeEach(() => {
	for (const item of feed.parse(payload).filter(feed.keep!)) {
		d1Query(`INSERT INTO items (source, guid, url, title, published_at, fetched_at)
			VALUES ('inception-labs', ${quote(item.guid)}, ${quote(item.url)}, ${quote(item.title)}, ${item.publishedAt}, 4100000100)
			ON CONFLICT DO NOTHING`);
	}
	d1Query(`INSERT INTO items (source, guid, url, title, fetched_at)
		VALUES ('apple', 'inception-other-source', 'https://example.com/other', 'Other source fixture', 4100000099)`);
});

test('shows Inception Labs, deduplicates cards, and filters to its official Mercury release', async ({ page }, testInfo) => {
	await page.goto('/signup');
	await page.getByLabel('Email').fill('connor@couetil.com');
	await page.getByLabel('Password').fill('correct-horse-battery');
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.waitForURL('**/');
	await page.locator('.source-filter summary').click();
	await page.screenshot({ path: testInfo.outputPath('inception-labs.png'), fullPage: true });
	const filter = page.getByRole('navigation', { name: 'Filter by source' });
	await filter.getByRole('link', { name: 'Inception Labs', exact: true }).click();
	await expect(page).toHaveURL(/\?source=inception-labs$/);
	const rows = page.locator('[data-feed-list] li[data-feed-row]');
	await expect(rows).toHaveCount(2);
	await expect(rows.getByRole('link', { name: 'Introducing Mercury 2.5', exact: true })).toHaveAttribute(
		'href', 'https://www.inceptionlabs.ai/blog/introducing-mercury-2-5',
	);
	await expect(rows.filter({ hasText: 'Other source fixture' })).toHaveCount(0);
	await expect(rows.first()).toContainText('Inception Labs');
	await expect(rows.first().locator('.mark-beat-ai.mark-round')).toBeVisible();
});
