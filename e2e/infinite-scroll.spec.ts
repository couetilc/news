import { test, expect, type Page } from '@playwright/test';
import { d1Query, resetUsers } from './d1';

// Browser e2e for the feed tabs + infinite scroll (issue #151). vitest renders
// the .astro server-side and never runs the client <script> blocks, and the
// IntersectionObserver scroll trigger is inherently a real-browser behavior — so
// the actual scroll → fetch → append loop is e2e-only. The pagination math, the
// sentinel markup, the /feed partial, and the loader's DOM logic are all unit-
// tested in the node project inside the 100% src/** gate; THIS spec verifies the
// pieces wire together in a real browser: the second page actually appends on
// scroll, the list stops cleanly when exhausted, and a tab switch is URL-
// addressable and survives reload.

const EMAIL = 'connor@couetil.com'; // the default signup allowlist (issue #76)
const PASSWORD = 'correct-horse-battery'; // >= 8 chars, a valid password

// Seed `n` unread items (newest id last) so the feed has more than one 50-item
// page. Done BEFORE the first page load so the dev server's D1 binding sees them
// on render (the dev server and `wrangler d1 execute --local` share the same
// .wrangler/state/v3/d1 persistence). Clears read state so every row starts unread.
function seedItems(n: number): void {
	d1Query('DELETE FROM items');
	d1Query('DELETE FROM item_reads');
	// One multi-row insert keeps it a single CLI round-trip. fetched_at ascending
	// so the ORDER BY (published null → fetched DESC, id DESC) gives a stable order.
	const values = Array.from(
		{ length: n },
		(_, i) =>
			`('cloudflare-blog', 'e2e-scroll-${i}', 'https://example.com/scroll-${i}', 'Scroll headline ${i}', ${1000 + i})`,
	).join(',');
	d1Query(
		`INSERT INTO items (source, guid, url, title, fetched_at) VALUES ${values}`,
	);
}

async function signUp(page: Page): Promise<void> {
	await page.goto('/signup');
	await page.getByLabel('Email').fill(EMAIL);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.waitForURL('**/');
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test.describe('feed tabs + infinite scroll (#151)', () => {
	test.beforeEach(() => {
		resetUsers();
	});

	test('appends the next 50 on scroll, then ends cleanly with no more fetches', async ({
		page,
	}) => {
		// 60 unread items → first page renders 50 + a sentinel; scrolling appends the
		// final 10 and the list is exhausted (no sentinel left, no phantom fetch).
		seedItems(60);
		await signUp(page);

		const items = page.locator('[data-feed-list] > li:not([data-feed-sentinel])');
		// First page: exactly 50 rows server-rendered.
		await expect(items).toHaveCount(50);
		const sentinel = page.locator('[data-feed-sentinel]');
		await expect(sentinel).toHaveCount(1);

		// Count the /feed partial requests so we can assert there's no phantom fetch
		// past the end.
		let feedRequests = 0;
		page.on('request', (req) => {
			if (new URL(req.url()).pathname === '/feed') feedRequests++;
		});

		// Scroll the sentinel into view → the observer fires → the next page appends.
		await sentinel.scrollIntoViewIfNeeded();

		// All 60 rows are now present and the sentinel is gone (list exhausted).
		await expect(items).toHaveCount(60);
		await expect(sentinel).toHaveCount(0);
		expect(feedRequests).toBe(1);

		// Scrolling to the very bottom again fires no further request — the clean
		// end-of-list state (#151, "no phantom empty fetch").
		await page.mouse.wheel(0, 5000);
		await page.waitForTimeout(300);
		expect(feedRequests).toBe(1);
	});

	test('tabs are URL-addressable, default to Unread, and survive reload', async ({ page }) => {
		// Two items; both start unread (read state is per-user and seeded empty). The
		// test then marks one read so the two tabs hold different items.
		d1Query('DELETE FROM items');
		d1Query('DELETE FROM item_reads');
		d1Query(
			`INSERT INTO items (source, guid, url, title, fetched_at) VALUES
			 ('cloudflare-blog', 'e2e-a', 'https://example.com/a', 'Headline alpha', 2000),
			 ('cloudflare-blog', 'e2e-b', 'https://example.com/b', 'Headline beta', 1000)`,
		);
		await signUp(page);

		// Default view is the Unread tab (no ?tab in the URL): both unread items show.
		await expect(page).not.toHaveURL(/tab=/);
		await expect(page.getByText('Headline alpha')).toBeVisible();
		await expect(page.getByText('Headline beta')).toBeVisible();

		// Mark the newest (alpha) read; the no-JS-safe POST → 303 returns to the
		// Unread tab, where alpha is now gone and only beta remains.
		await page
			.locator('li', { hasText: 'Headline alpha' })
			.getByRole('button', { name: 'Mark as read' })
			.click();
		await expect(page.getByText('Headline alpha')).toBeHidden();
		await expect(page.getByText('Headline beta')).toBeVisible();

		// Switch to the Read tab: a normal link, so the URL becomes ?tab=read and the
		// read item (alpha) shows there while the still-unread beta does not.
		await page.getByRole('link', { name: /^Read/ }).click();
		await expect(page).toHaveURL(/[?&]tab=read/);
		await expect(page.getByText('Headline alpha')).toBeVisible();
		await expect(page.getByText('Headline beta')).toBeHidden();

		// Reload: the active tab survives because it's in the URL.
		await page.reload();
		await expect(page).toHaveURL(/[?&]tab=read/);
		await expect(page.getByText('Headline alpha')).toBeVisible();
	});
});
