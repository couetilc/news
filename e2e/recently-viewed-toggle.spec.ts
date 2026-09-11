import { test, expect, type Page } from '@playwright/test';
import { d1Query, resetUsers } from './d1';
// Red -> green: the old lane toggle changes filtered tallies for unrelated
// sources, never reinserts a matching unread story, and leaves an empty lane.
async function signUp(page: Page) {
	await page.goto('/signup');
	await page.getByLabel('Email').fill('connor@couetil.com');
	await page.getByLabel('Password').fill('correct-horse-battery');
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.waitForURL('**/');
}
async function expandRecent(page: Page) {
	const details = page.locator('[data-recently-viewed] details');
	if (await details.count() && (await details.getAttribute('open')) === null)
		await details.locator('summary').click();
}
test.beforeEach(() => { resetUsers(); d1Query('DELETE FROM item_reads'); d1Query('DELETE FROM items'); });
test('unrelated lane item leaves filtered tallies alone and removes empty history', async ({ page }) => {
	d1Query(`INSERT INTO items(source,guid,url,title,fetched_at) VALUES
		('openai','a','https://example.com/a','OpenAI one',30),
		('openai','b','https://example.com/b','OpenAI two',20),
		('cloudflare-blog','c','https://example.com/c','Other source',10)`);
	await signUp(page);
	d1Query(`INSERT INTO item_reads(user_id,item_id,read_at) SELECT u.id,i.id,100 FROM users u CROSS JOIN items i WHERE source='cloudflare-blog'`);
	await page.goto('/?source=openai');
	await expandRecent(page);
	await page.locator('[data-recently-viewed]').getByRole('button', { name: 'Mark as unread' }).click();
	await expect(page.locator('[data-recently-viewed]')).toHaveCount(0);
	await expect(page.locator('[data-tab-count="unread"]')).toHaveText('2');
	await expect(page.locator('[data-tab-count="read"]')).toHaveText('0');
	await expect(page.locator('[data-feed-list] [data-feed-row]')).toHaveCount(2);
});
test('matching lane item reappears in order, keeps pagination contiguous, and can be read again', async ({ page }) => {
	const values = Array.from({ length: 55 }, (_, i) => `('openai','n${i}','https://example.com/n${i}','Story ${String(i).padStart(2, '0')}',${1000 - i})`).join(',');
	d1Query(`INSERT INTO items(source,guid,url,title,fetched_at) VALUES ${values}`);
	await signUp(page);
	d1Query(`INSERT INTO item_reads(user_id,item_id,read_at) SELECT u.id,i.id,100 FROM users u CROSS JOIN items i WHERE guid='n3'`);
	await page.goto('/?source=openai');
	await expandRecent(page);
	await page.locator('[data-recently-viewed]').getByRole('button', { name: 'Mark as unread' }).click();
	const rows = page.locator('[data-feed-list] [data-feed-row]');
	await expect(rows.nth(3)).toContainText('Story 03');
	await expect(rows.nth(3)).toHaveCSS('opacity', '1');
	await expect(page.locator('[data-tab-count="unread"]')).toHaveText('55');
	await expect(page.locator('[data-feed-sentinel]')).toHaveAttribute('data-next-url', '/feed?tab=unread&source=openai&offset=51');
	await page.locator('[data-feed-sentinel]').scrollIntoViewIfNeeded();
	await expect(rows).toHaveCount(55);
	await expect(page.locator('[data-feed-sentinel]')).toHaveCount(0);
	const titles = await rows.locator('h2').allTextContents();
	expect(titles.map(x => x.trim())).toEqual(Array.from({ length: 55 }, (_, i) => `Story ${String(i).padStart(2, '0')}`));
	await rows.nth(3).getByRole('button', { name: 'Mark as read', exact: true }).click();
	await expect(rows).toHaveCount(54);
});
test('unreading the only matching story replaces the caught-up state', async ({ page }) => {
	d1Query(`INSERT INTO items(source,guid,url,title,fetched_at) VALUES ('openai','only','https://example.com/only','Only story',10)`);
	await signUp(page);
	d1Query(`INSERT INTO item_reads(user_id,item_id,read_at) SELECT u.id,i.id,100 FROM users u CROSS JOIN items i`);
	await page.goto('/?source=openai');
	await expandRecent(page);
	await expect(page.locator('[data-feed-empty]')).toBeVisible();
	await page.locator('[data-recently-viewed]').getByRole('button', { name: 'Mark as unread' }).click();
	await expect(page.locator('[data-feed-empty]')).toHaveCount(0);
	await expect(page.locator('[data-feed-list]')).toContainText('Only story');
	await expect(page.locator('[data-recently-viewed]')).toHaveCount(0);
});
