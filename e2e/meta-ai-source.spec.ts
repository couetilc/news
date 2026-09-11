import { expect, test } from '@playwright/test';
import { d1Query, resetUsers } from './d1';

// Red -> green pin: without Meta AI's presentation registration, the filter
// and dateline show the raw meta-ai slug. Exercise the real authenticated
// filter and article destination on a phone-sized viewport.
const GUID = 'e2e-meta-ai-source';
const TITLE = 'Introducing Muse Voice Transcribe';
const URL = 'https://research.meta.ai/blog/introducing-muse-voice-transcribe';

test.use({ viewport: { width: 390, height: 844 } });

test.beforeAll(() => {
	resetUsers();
	d1Query(`DELETE FROM items WHERE guid IN ('${GUID}', '${GUID}-other')`);
	d1Query(`INSERT INTO items (source, guid, url, title, fetched_at) VALUES
		('meta-ai', '${GUID}', '${URL}', '${TITLE}', 4100000100),
		('apple', '${GUID}-other', 'https://example.com/${GUID}', 'Other source fixture', 4100000099)`);
});

test.afterAll(() => {
	d1Query(`DELETE FROM items WHERE guid IN ('${GUID}', '${GUID}-other')`);
});

test('filters to Meta AI and links to the official model announcement', async ({ page }, testInfo) => {
	await page.goto('/signup');
	await page.getByLabel('Email').fill('connor@couetil.com');
	await page.getByLabel('Password').fill('correct-horse-battery');
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.waitForURL('**/');
	await page.screenshot({ path: testInfo.outputPath('meta-ai-source.png'), fullPage: true });

	const filter = page.getByRole('navigation', { name: 'Filter by source' });
	await filter.getByRole('link', { name: 'Meta AI', exact: true }).click();
	await expect(page).toHaveURL(/\?source=meta-ai$/);
	await expect(filter.getByRole('link', { name: 'Meta AI', exact: true })).toHaveAttribute(
		'aria-current', 'true',
	);
	const rows = page.locator('li[data-feed-row]');
	await expect(rows).toHaveCount(1);
	await expect(rows.getByRole('link', { name: TITLE, exact: true })).toHaveAttribute('href', URL);
	await expect(rows).toContainText('Meta AI');
	await expect(rows.locator('.mark-beat-ai.mark-dots')).toBeVisible();
});
