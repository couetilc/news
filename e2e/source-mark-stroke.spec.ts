import { expect, test } from './fixtures';
import { d1Query } from './d1';

// Browser regression for the hollow source-mark stroke. Red -> green pin: the
// previous 2px border left a 6px empty center. The heavier 3px frame shrinks
// that center to 4px while keeping the source mark's 10px outer footprint.

const GUID = 'e2e-hollow-source-mark-stroke';
const TITLE = 'Hollow source mark stroke fixture';

test.describe('hollow source-mark stroke', () => {
	test.beforeEach(() => {
		d1Query(`DELETE FROM items WHERE guid = '${GUID}'`);
		d1Query(
			`INSERT INTO items (source, guid, url, title, fetched_at)
			 VALUES ('apple', '${GUID}', 'https://example.com/${GUID}', '${TITLE}', 4100000100)`,
		);
	});

	test.afterEach(() => {
		d1Query(`DELETE FROM items WHERE guid = '${GUID}'`);
	});

	test('uses a 3px frame around a 4px empty center', async ({ page }) => {
		await page.goto('/');

		const row = page.locator('li[data-feed-row]').filter({ hasText: TITLE });
		const mark = row.locator('.mark-hollow');
		await expect(mark).toBeVisible();

		const geometry = await mark.evaluate((element) => ({
			outerWidth: element.getBoundingClientRect().width,
			innerWidth: element.clientWidth,
			borderWidth: getComputedStyle(element).borderLeftWidth,
		}));

		expect(geometry).toEqual({ outerWidth: 10, innerWidth: 4, borderWidth: '3px' });
	});
});
