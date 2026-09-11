import { test, expect } from './fixtures';
import { d1Query } from './d1';

for (const change of ['insert', 'cross-tab read'] as const) {
	test(`pagination keeps every remaining article after ${change}`, async ({ page, context }) => {
		// Equal fractional effective dates exercise the ID tiebreaker, including
		// published_at=NULL. An unrelated source must stay excluded on every page.
		const rows = Array.from({ length: 101 }, (_, i) => `(${i + 1},'cloudflare-blog','page-${i}','https://example.com/${i}','Headline ${i}',${i % 2 ? 'NULL' : '1000.125'},1000.125)`).join(',');
		d1Query(`INSERT INTO items(id,source,guid,url,title,published_at,fetched_at) VALUES ${rows},(102,'ieee-spectrum','excluded','https://example.com/excluded','Excluded',1000.125,1000.125)`);
		await page.goto('/signup');
		await page.getByLabel('Email').fill('connor@couetil.com');
		await page.getByLabel('Password').fill('correct-horse-battery');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/');
		await page.goto('/?source=cloudflare-blog');
		const items = page.locator('[data-feed-list] [data-feed-row]');
		await expect(items).toHaveCount(50);
		const ids = () => items.evaluateAll(rows => rows.map(row => Number(row.getAttribute('data-item-id'))));
		expect(await ids()).toEqual(Array.from({ length: 50 }, (_, i) => 101 - i));
		const sentinel = page.locator('[data-feed-sentinel]');
		const boundary = await sentinel.getAttribute('data-next-url');
		expect(boundary).toContain('cursor=');
		if (change === 'insert') {
			d1Query("INSERT INTO items(source,guid,url,title,published_at,fetched_at) VALUES('cloudflare-blog','arrived','https://example.com/arrived','New arrival',2000,2000)");
		} else {
			const other = await context.newPage();
			await other.goto('/?source=cloudflare-blog');
			await other.locator('[data-feed-list] [data-item-id="101"] button').click();
			await expect(other.locator('[data-feed-list] [data-item-id="101"]')).toHaveCount(0);
			await other.close();
		}
		expect(await sentinel.getAttribute('data-next-url')).toBe(boundary);
		await sentinel.scrollIntoViewIfNeeded();
		await expect(items).toHaveCount(100);
		await sentinel.scrollIntoViewIfNeeded();
		await expect(items).toHaveCount(101);
		await expect(sentinel).toHaveCount(0);
		expect(await ids()).toEqual(Array.from({ length: 101 }, (_, i) => 101 - i));
		for (const query of ['cursor=' + '9'.repeat(400), 'cursor=%5B1%2C0%5D', 'offset=' + '9'.repeat(400)]) {
			const status = await page.evaluate(async query => (await fetch('/feed?' + query)).status, query);
			expect(status).toBe(400);
		}
	});
}
