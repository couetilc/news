import { test, expect, type Page } from '@playwright/test';
import { d1Query, resetUsers } from './d1';

// Browser e2e for the scroll-preserving in-place read toggle (issue #223).
//
// The bug this pins: marking an item read/unread used to snap the reader back to
// the TOP of the feed. The toggle was a no-JS form POST → 303 redirect, and even
// with JS on <ClientRouter /> turned that into a navigation to the returnTo target
// (offset deliberately stripped → the tab re-rendered from its first 50), so the
// browser scrolled to top — losing the reader's place several screens down.
//
// The fix (src/scripts/enhance-forms.ts): with JS on the delegated submit listener
// INTERCEPTS the read form, `fetch`es the POST itself, and updates the row in place
// (removes it from the active tab, re-tallies the tabs) WITHOUT any navigation, so
// the scroll position is undisturbed. This spec is the red→green pin: it would FAIL
// on the pre-#223 navigation (scrollY collapses to ~0 after the toggle) and PASSES
// with the in-place update (scrollY essentially unchanged).
//
// Progressive enhancement is untouched: the no-JS POST → 303 → reload remains the
// source of truth and the /api/read write is idempotent both ways; this only
// asserts the JS layer keeps the reader's place.

const EMAIL = 'connor@couetil.com'; // the default signup allowlist (issue #76)
const PASSWORD = 'correct-horse-battery'; // >= 8 chars, a valid password

// Enough unread items that the feed scrolls well past one viewport, so a toggle
// low in the list has a meaningful scroll offset to preserve.
const SEED_COUNT = 40;

// Sign up (the allowlisted first user) so the homepage renders the interactive
// read/unread toggle. Returns once the signed-in homepage has loaded.
async function signUp(page: Page): Promise<void> {
	await page.goto('/signup');
	await page.getByLabel('Email').fill(EMAIL);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.waitForURL('**/');
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

test.describe('read toggle preserves scroll position (#223)', () => {
	test.beforeEach(() => {
		resetUsers();
	});

	test('marking an item read mid-feed leaves the scroll position unchanged', async ({ page }) => {
		// Seed a feed of unread items BEFORE any page load (the dev server and
		// `wrangler d1 execute --local` share the same .wrangler/state/v3/d1
		// persistence). Distinct fetched_at so the order is stable, newest first.
		d1Query('DELETE FROM items');
		d1Query('DELETE FROM item_reads');
		const values = Array.from({ length: SEED_COUNT }, (_, i) => {
			const n = i + 1;
			return `('cloudflare-blog', 'e2e-scroll-${n}', 'https://example.com/scroll-${n}', 'Scroll headline number ${n}', ${1000 + n})`;
		}).join(',\n');
		d1Query(`INSERT INTO items (source, guid, url, title, fetched_at) VALUES ${values}`);

		await signUp(page);

		// The unread tab tally starts at the full seed count.
		const unreadTally = page.locator('[data-tab-count="unread"]');
		await expect(unreadTally).toHaveText(String(SEED_COUNT));

		// Scroll to a fixed offset deep in the feed (well past one viewport) so a
		// toggle here has real scroll to lose. A fixed window.scrollTo keeps the
		// anchor deterministic across runs (unlike scrollIntoViewIfNeeded, which can
		// land a row anywhere in the viewport).
		const anchorY = 1500;
		await page.evaluate((y) => window.scrollTo(0, y), anchorY);
		const beforeY = await page.evaluate(() => window.scrollY);
		const beforeUrl = page.url();
		// Sanity: we're genuinely scrolled down (so a snap-to-top would be glaring).
		expect(beforeY).toBeGreaterThan(800);

		// Toggle a row that is CURRENTLY VISIBLE at this anchor (so removing it shifts
		// only content at/below the viewport top, never above it — the scroll anchor
		// is undisturbed). Rows are newest-first; near y=1500 we're well into the
		// list, so target a mid-list row that's on screen here.
		const targetRow = page.locator('li[data-feed-row]', {
			hasText: 'Scroll headline number 20',
		});
		const targetSquare = targetRow.getByRole('button', { name: 'Mark as read' });
		await expect(targetSquare).toBeInViewport();

		await targetSquare.click();

		// The row leaves the Unread tab in place — no navigation. Wait for the row to
		// be gone and the tally to decrement, which is the completion signal.
		await expect(targetRow).toHaveCount(0);
		await expect(unreadTally).toHaveText(String(SEED_COUNT - 1));

		// The core assertion: the URL never changed (no navigation) and the scroll
		// position is essentially where the reader left it — NOT collapsed to the top
		// (the pre-#223 behavior would put afterY at ~0). A small drift is allowed for
		// the removed row's own height, but afterY stays deep in the feed.
		expect(page.url()).toBe(beforeUrl);
		const afterY = await page.evaluate(() => window.scrollY);
		expect(afterY).toBeGreaterThan(beforeY - 120);
		// And it is unmistakably NOT a snap-to-top: still scrolled most of the way down.
		expect(afterY).toBeGreaterThan(800);
	});
});
