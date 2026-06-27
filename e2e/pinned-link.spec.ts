import { test, expect } from '@playwright/test';

// Browser e2e for the pinned reference strip (#316): the JP Morgan *Trump Policy
// Impact Tracker* PDF, pinned above the FilterBar on the homepage.
//
// This is the nice-to-have full-browser guard for the visible feature (the unit
// test in test/pinned-links.test.ts already asserts the markup contract). It
// drives the real dev server and asserts the link is present and points at the
// canonical PDF, located by its DESTINATION (a stable selector) inside the
// "Pinned references" landmark — anonymous, so it covers the public homepage.

const TRACKER_HREF =
	'https://assets.jpmprivatebank.com/content/dam/jpm-pb-aem/global/en/documents/eotm/trump-tracker.pdf';

test.describe('pinned Trump Policy Impact Tracker link (#316)', () => {
	test('an anonymous visitor sees the pinned PDF link pointing at the tracker', async ({ page }) => {
		await page.goto('/');

		// The pinned strip is its own labeled lane on the homepage.
		const strip = page.locator('nav[aria-label="Pinned references"]');
		await expect(strip).toBeVisible();

		// The link carries its label, points at the canonical PDF, and opens in a
		// new tab with the safe rel.
		const link = strip.locator(`a[href="${TRACKER_HREF}"]`);
		await expect(link).toBeVisible();
		await expect(link).toContainText('Trump Policy Impact Tracker');
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

		// It's marked as a PDF.
		await expect(strip.getByText('PDF', { exact: true })).toBeVisible();
	});

	test('the pinned strip sits above the source filter / feed', async ({ page }) => {
		await page.goto('/');
		const strip = page.locator('nav[aria-label="Pinned references"]');
		const feed = page.locator('ol').first();
		await expect(strip).toBeVisible();
		// The strip's top edge is above the feed's — the decided Option A placement.
		const stripBox = await strip.boundingBox();
		const feedBox = await feed.boundingBox();
		expect(stripBox).not.toBeNull();
		expect(feedBox).not.toBeNull();
		expect((stripBox as { y: number }).y).toBeLessThan((feedBox as { y: number }).y);
	});
});
