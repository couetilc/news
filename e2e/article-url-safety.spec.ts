import { test, expect } from './fixtures';
import { d1Query } from './d1';

test('unsafe legacy article links cannot execute in the reader', async ({ page }) => {
	// Existing/imported rows need rendering defense even after ingestion is fixed.
	d1Query(`INSERT INTO items (source,guid,url,title,fetched_at) VALUES
		('cloudflare-blog','unsafe','javascript:void(document.documentElement.dataset.reviewProbe=1)','Unsafe legacy article',1789146000),
		('cloudflare-blog','safe','https://example.com/article#part','Safe article',1789146000)`);
	await page.goto('/');
	await expect(page.getByRole('link', { name: 'Unsafe legacy article' })).toHaveCount(0);
	await expect(page.getByText('Link unavailable')).toBeVisible();
	await page.getByRole('heading', { name: 'Unsafe legacy article' }).click();
	await expect(page.locator('html')).not.toHaveAttribute('data-review-probe');
	await expect(page.getByRole('link', { name: 'Safe article' })).toHaveAttribute('href', 'https://example.com/article#part');
});
