import { expect, test } from '@playwright/test';
import { d1Query } from './d1';

// Browser regression for the hollow source-mark stroke. Red -> green pin: the
// old 1.5px declaration rendered as a 1px border in Chromium, leaving an 8px
// empty center that looked like an unchecked control. The heavier frame must
// render as 2px while keeping the source mark's 10px outer footprint.

const GUID = 'e2e-hollow-source-mark-stroke';
const TITLE = 'Hollow source mark stroke fixture';

test.describe('hollow source-mark stroke', () => {
	test.beforeAll(() => {
		d1Query(`DELETE FROM items WHERE guid = '${GUID}'`);
		d1Query(
			`INSERT INTO items (source, guid, url, title, fetched_at)
			 VALUES ('apple', '${GUID}', 'https://example.com/${GUID}', '${TITLE}', 4100000100)`,
		);
	});

	test.afterAll(() => {
		d1Query(`DELETE FROM items WHERE guid = '${GUID}'`);
	});

	test('uses a 2px frame around a 6px empty center', async ({ page }) => {
		await page.goto('/');

		const row = page.locator('li[data-feed-row]').filter({ hasText: TITLE });
		const mark = row.locator('.mark-hollow');
		await expect(mark).toBeVisible();

		const geometry = await mark.evaluate((element) => ({
			outerWidth: element.getBoundingClientRect().width,
			innerWidth: element.clientWidth,
			borderWidth: getComputedStyle(element).borderLeftWidth,
		}));

		expect(geometry).toEqual({ outerWidth: 10, innerWidth: 6, borderWidth: '2px' });
	});
});
