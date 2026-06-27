import { test, expect, type Locator, type Page } from '@playwright/test';
import { resetUsers } from './d1';

// Browser e2e for the mobile masthead session-control layout (issue #317).
//
// Why this exists — and why a unit test could not catch the bug it pins: #317 is
// a VIEWPORT-DEPENDENT visual bug. The session control was positioned
// out-of-flow (`absolute right-3 top-2`) inside the centered, double-ruled
// masthead, so on a narrow phone the "Sign out" button (and the anonymous
// "Log in" link) physically OVERLAPPED the centered dateline / "News" nameplate
// / tagline. A Container API unit test renders the markup but has no layout
// engine — it can assert the responsive utility classes are PRESENT (see
// test/layout.test.ts), never that two boxes don't intersect at 375px. Only a
// real browser at a real width measures geometry, so only this can pin the fix.
//
// The fix (#317): mobile-first — the control sits in NORMAL FLOW on its own
// right-aligned line above the nameplate at phone width, switching back to the
// absolute top-right corner only at sm:+.
//
// Red→green pin (the regression-test convention from status-link.spec.ts /
// auth-signup.spec.ts): against the pre-fix `absolute right-3 top-2` layout the
// "does not overlap" assertions FAIL at 375px (the control's box intersects the
// nameplate's); they PASS once the control is in flow on mobile.

// iPhone-class phone width (the 360–390px band the issue calls out).
const PHONE = { width: 375, height: 812 };

const EMAIL = 'connor@couetil.com'; // the default signup allowlist (issue #76)
const PASSWORD = 'correct-horse-battery'; // >= 8 chars, a valid password

// Two boxes overlap iff they intersect on BOTH axes. A tiny epsilon absorbs
// sub-pixel rounding so a clean edge-to-edge stack (control's bottom touching the
// nameplate's top) doesn't read as an overlap.
async function overlaps(a: Locator, b: Locator): Promise<boolean> {
	const ba = await a.boundingBox();
	const bb = await b.boundingBox();
	if (!ba || !bb) throw new Error('a control under test was not laid out');
	const EPS = 0.5;
	const xOverlap = ba.x < bb.x + bb.width - EPS && bb.x < ba.x + ba.width - EPS;
	const yOverlap = ba.y < bb.y + bb.height - EPS && bb.y < ba.y + ba.height - EPS;
	return xOverlap && yOverlap;
}

// The three centered nameplate elements the control must clear: the dateline
// (/status link), the "News" h1, and the tagline.
function nameplateParts(page: Page): Locator[] {
	return [
		page.locator('header a[href="/status"]'),
		page.getByRole('heading', { name: 'News', level: 1 }),
		page.getByText('All the feeds fit to print'),
	];
}

async function expectClearsNameplate(page: Page, control: Locator): Promise<void> {
	await expect(control).toBeVisible();
	for (const part of nameplateParts(page)) {
		expect(await overlaps(control, part)).toBe(false);
	}
}

test.describe('masthead session control does not overlap the nameplate on mobile (#317)', () => {
	test.use({ viewport: PHONE });

	test.beforeEach(() => {
		resetUsers();
	});

	test('the anonymous Log in link clears the centered nameplate at 375px', async ({ page }) => {
		await page.goto('/');
		const login = page.getByRole('link', { name: 'Log in' });
		await expectClearsNameplate(page, login);
	});

	test('the signed-in Sign out control clears the centered nameplate at 375px', async ({
		page,
	}) => {
		// A real signup → session cookie so the masthead renders Sign out, not Log in.
		await page.goto('/signup');
		await page.getByLabel('Email').fill(EMAIL);
		await page.getByLabel('Password').fill(PASSWORD);
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/');

		const signOut = page.getByRole('button', { name: 'Sign out' });
		await expectClearsNameplate(page, signOut);
	});

	// The layout change is purely positional; the no-JS source-of-truth path
	// (POST /logout → 303 → /login) must be untouched. Drive it with JavaScript
	// DISABLED in the browser context, so the Sign out <form> submits as a genuine
	// document POST (no client enhancement, no ClientRouter) — the real no-JS path,
	// CSRF-validated by the browser's same-origin Origin header that a raw
	// `request.post` can't reproduce. The control still has to be reachable on the
	// mobile masthead, which is the point of #317.
	test.describe('no-JS', () => {
		test.use({ javaScriptEnabled: false });

		test('the Sign out form still logs out → /login at 375px with JS off', async ({ page }) => {
			// Sign up with JS off (a real POST form too) to get a session cookie.
			await page.goto('/signup');
			await page.getByLabel('Email').fill(EMAIL);
			await page.getByLabel('Password').fill(PASSWORD);
			await page.getByRole('button', { name: 'Create account' }).click();
			await page.waitForURL('**/');

			// The Sign out button is in the mobile masthead and clickable (not buried
			// behind the nameplate). Submitting its form does the no-JS POST /logout.
			await page.getByRole('button', { name: 'Sign out' }).click();
			await page.waitForURL('**/login');
			await expect(page).toHaveURL(/\/login\/?$/);
			// Logged out: the anonymous Log in control is back in the masthead.
			await expect(page.getByRole('link', { name: 'Log in' })).toBeVisible();
		});
	});
});
