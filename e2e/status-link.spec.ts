import { test, expect, type Page } from '@playwright/test';
import { resetUsers } from './d1';

// Browser e2e for the masthead dateline /status link (issue #287 regression,
// retargeted at the dateline by #305).
//
// Why this exists — and why a unit test could not catch the bug it pins:
// /status is `export const prerender = true`, and Astro runs the auth
// middleware (src/middleware.ts) WHILE PRERENDERING at build time, where there
// is no session. The original colophon PR (#282) added the link and a Container
// API unit test (test/layout.test.ts) asserting `href="/status"` is in the
// markup — but the Container API has no middleware, no routing, and no
// prerender step, so it could only prove the link EXISTS, never that its
// destination is REACHABLE. With /status missing from the middleware's
// PUBLIC_PATHS allowlist, the build-time render took the unauthenticated branch
// and `context.redirect('/login', 303)`, which Astro froze into the static
// dist/client/status/index.html as a `<meta http-equiv="refresh" url=/login>`
// stub. That stub bounced EVERY visitor to /login — anonymous and logged-in
// alike, because a prerendered asset is served without ever invoking the worker
// (so being logged in cannot help). Only a real browser driving the BUILT
// `astro preview` output exercises that build→prerender→<ClientRouter /> chain.
//
// #305 folded the /status link into the masthead dateline and dropped the
// standalone colophon "Status" link, so this spec now drives the dateline link.
// It targets the link by its DESTINATION (`header a[href="/status"]`), not the
// visible date text — the dateline reads today's date, which changes daily, so a
// text match would rot. The destination selector is stable across dates.
//
// Red→green pin (the regression-test convention from auth-signup.spec.ts): with
// /status absent from PUBLIC_PATHS these FAIL — clicking the dateline lands on
// /login — and they PASS once it is allowlisted and the page prerenders for real.

// From the home feed, click the masthead dateline link and return so the caller
// can assert where it landed. <ClientRouter /> is mounted globally, so this click
// is an enhanced client navigation, not a plain document load — the exact path
// users take. Located by destination (a stable selector) rather than the daily
// date text.
async function clickStatusFromHome(page: Page): Promise<void> {
	await page.goto('/');
	// The masthead has exactly one /status link — the dateline (#305).
	await page.locator('header a[href="/status"]').click();
}

// Assert we reached the real, prerendered /status page (deploy metadata only),
// NOT the /login redirect stub the regression produced. We assert on the page's
// own content + URL rather than the masthead: /status is prerendered at build
// time with no session, so its masthead always shows the anonymous "Log in"
// control even for a logged-in visitor — that is an inherent property of
// prerendering, not part of this fix, so the test must not expect "Sign out".
async function expectOnStatusPage(page: Page): Promise<void> {
	await expect(page).toHaveURL(/\/status\/?$/);
	await expect(page).not.toHaveURL(/\/login/);
	// The operational page's own copy — present on /status, absent on /login.
	await expect(page.getByRole('heading', { name: 'Status' })).toBeVisible();
	await expect(page.getByText('What is running in production right now.')).toBeVisible();
}

test.describe('masthead dateline link reaches the public status page (#287, #305)', () => {
	test('an anonymous visitor lands on /status, not /login', async ({ page }) => {
		await clickStatusFromHome(page);
		await expectOnStatusPage(page);
	});

	test('a logged-in visitor lands on /status, not /login', async ({ page }) => {
		// The redirect stub was baked at build time, so it bounced logged-in users
		// too — the "even if the user is already logged in" half of the report. Sign
		// in first (a real signup → session cookie), then take the same path.
		resetUsers();
		await page.goto('/signup');
		await page.getByLabel('Email').fill('connor@couetil.com');
		await page.getByLabel('Password').fill('correct-horse-battery');
		await page.getByRole('button', { name: 'Create account' }).click();
		await page.waitForURL('**/');
		await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

		await clickStatusFromHome(page);
		await expectOnStatusPage(page);
	});
});
