import { test, expect, type Page } from '@playwright/test';
import { d1Query, resetUsers } from './d1';

// Browser e2e for the "Recently viewed" lane (#334).
//
// Red→green pin: on pre-#334 code opening an article changed NO server state —
// the click only wrote a per-device localStorage "Opened" tag — so after
// clicking a headline the item was still in Unread (tally unchanged) and no
// "Recently viewed" section existed anywhere; this spec FAILS there. With #334
// the click beacons a read=1 POST to /api/read (sendBeacon, no preventDefault —
// the navigation to the article proceeds), so on returning to the feed the item
// has left Unread and renders in the lane above the list; the spec PASSES.
//
// This covers what the hermetic pools can't: the real click → sendBeacon-during-
// navigation → D1 write → server re-render round-trip in a real browser. The
// query ordering/cap and the script's transport fallbacks are unit-tested
// (test/db.test.ts, test/opened.test.ts); this stays one focused primary path.
//
// The seeded article URLs point at the local /status page (public, always up),
// so the click's navigation never leaves the box.

const EMAIL = 'connor@couetil.com'; // the default signup allowlist (issue #76)
const PASSWORD = 'correct-horse-battery'; // >= 8 chars, a valid password

const SEED_COUNT = 5;

// Sign up (the allowlisted first user) so the homepage renders the interactive
// feed. Returns once the signed-in homepage has loaded.
async function signUp(page: Page): Promise<void> {
	await page.goto('/signup');
	await page.getByLabel('Email').fill(EMAIL);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.waitForURL('**/');
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test.describe('recently viewed lane (#334)', () => {
	test.beforeEach(() => {
		resetUsers();
	});

	test('opening an article moves it out of Unread into the Recently viewed lane', async ({
		page,
		baseURL,
	}) => {
		// Seed a small unread feed BEFORE any page load (the preview server and
		// `wrangler d1 execute --local` share the same .wrangler/state/v3/d1
		// persistence). Distinct fetched_at so the order is stable, newest first;
		// URLs stay on the local server.
		d1Query('DELETE FROM items');
		d1Query('DELETE FROM item_reads');
		const values = Array.from({ length: SEED_COUNT }, (_, i) => {
			const n = i + 1;
			return `('cloudflare-blog', 'e2e-rv-${n}', '${baseURL}/status?item=${n}', 'Lane headline number ${n}', ${1000 + n})`;
		}).join(',\n');
		d1Query(`INSERT INTO items (source, guid, url, title, fetched_at) VALUES ${values}`);

		await signUp(page);

		// Baseline: everything unread, and no lane rendered anywhere.
		const unreadTally = page.locator('[data-tab-count="unread"]');
		await expect(unreadTally).toHaveText(String(SEED_COUNT));
		await expect(page.locator('[data-recently-viewed]')).toHaveCount(0);

		// Open a mid-list article the way a reader does: click its headline. The
		// beacon must not block the navigation — the browser lands on the article
		// (here the local /status page).
		await page
			.locator('li[data-feed-row] h2', { hasText: 'Lane headline number 3' })
			.click();
		await page.waitForURL('**/status**');

		// The sendBeacon POST races the navigation; wait until the read actually
		// landed in D1 before re-rendering the feed.
		await expect
			.poll(() => d1Query<{ n: number }>('SELECT COUNT(*) AS n FROM item_reads')[0].n)
			.toBe(1);

		// Back on the feed: the opened item has LEFT the unread list and sits in the
		// Recently viewed lane above it.
		await page.goto('/');
		const lane = page.locator('[data-recently-viewed]');
		await expect(lane).toBeVisible();
		await expect(lane.getByRole('heading', { name: 'Recently viewed' })).toBeVisible();
		await expect(
			lane.locator('li[data-feed-row]', { hasText: 'Lane headline number 3' }),
		).toHaveCount(1);
		await expect(unreadTally).toHaveText(String(SEED_COUNT - 1));
		await expect(
			page.locator('[data-feed-list] li[data-feed-row]', { hasText: 'Lane headline number 3' }),
		).toHaveCount(0);
		// And the lane precedes the unread list in the reading order.
		const laneBox = await lane.boundingBox();
		const listBox = await page.locator('[data-feed-list]').boundingBox();
		expect(laneBox).not.toBeNull();
		expect(listBox).not.toBeNull();
		expect(laneBox!.y).toBeLessThan(listBox!.y);
	});
});
