import { test, expect, type Page } from './fixtures';
import { d1Query, resetUsers } from './d1';

async function signUp(page: Page) {
	await page.goto('/signup');
	await page.getByLabel('Email').fill('connor@couetil.com');
	await page.getByLabel('Password').fill('correct-horse-battery');
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.waitForURL('**/');
}

// Red -> green: deleting users alone preserves read history and valid sessions
// pointing to reused IDs. A reset must make both disappear for the next user.
test('reset prevents a reused user ID inheriting history or a stale session', async ({ page, browser }) => {
	d1Query(`INSERT INTO items (source, guid, url, title, fetched_at)
		VALUES ('apple', 'isolation', 'https://example.com/isolation', 'Old reader history', 4100000100)`);
	await signUp(page);
	const row = page.locator('[data-feed-list] li[data-feed-row]');
	await row.getByRole('button', { name: 'Mark as read', exact: true }).click();
	await expect(row).toHaveCount(0);
	const oldUser = d1Query<{ id: number }>('SELECT id FROM users')[0].id;
	expect(d1Query('SELECT * FROM item_reads')).toHaveLength(1);

	await resetUsers();
	const freshContext = await browser.newContext();
	try {
		const freshPage = await freshContext.newPage();
		// Explicit URL because newContext does not inherit the fixture baseURL.
		await freshPage.goto(new URL('/signup', page.url()).href);
		await freshPage.getByLabel('Email').fill('connor@couetil.com');
		await freshPage.getByLabel('Password').fill('correct-horse-battery');
		await freshPage.getByRole('button', { name: 'Create account' }).click();
		await freshPage.waitForURL('**/');
		expect(d1Query<{ id: number }>('SELECT id FROM users')[0].id).toBe(oldUser);
		expect(d1Query('SELECT * FROM item_reads')).toEqual([]);
		await expect(freshPage.getByRole('region', { name: 'Recently viewed' })).toHaveCount(0);
		await expect(freshPage.locator('[data-feed-list]')).toContainText('Old reader history');

		// The prior browser still holds its old cookie. It must be anonymous even
		// though the new account now has the same numeric ID.
		await page.reload();
		await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Log in', exact: true })).toBeVisible();
	} finally {
		await freshContext.close();
	}
});
