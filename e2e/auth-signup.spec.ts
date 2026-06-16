import { test, expect, type Page, type Request } from '@playwright/test';
import { d1Query, resetUsers } from './d1';

// Browser e2e for the auth-form routing + first-signup flow (issue #124).
//
// Why this exists: <ClientRouter /> is mounted globally in Layout.astro, so it
// intercepts a plain form POST as an enhanced `fetch` (resourceType 'fetch',
// isNavigationRequest false) instead of a real document navigation. That is the
// right default for the read/unread toggle, but credential/session-changing auth
// forms should be boring full-page navigations. The fix is `data-astro-reload`
// on the shared AuthForm.astro (and the masthead logout form). vitest can't see
// any of this — it mocks the action or renders the .astro directly — so this
// pins the choice in a real browser. The signup POST asserting
// resourceType==='document' is the red→green pin: it FAILS without
// data-astro-reload (the POST is a client-router fetch) and PASSES with it.

const EMAIL = 'connor@couetil.com'; // the default signup allowlist (issue #76)
const PASSWORD = 'correct-horse-battery'; // >= 8 chars, a valid password

// Run the first-signup flow from a given signup URL, capturing the POST request
// so the caller can assert it is a real navigation. Both `/signup` and
// `/signup/` (trailing slash, the #115 fix) are exercised through this.
async function submitSignup(page: Page, signupPath: string): Promise<Request> {
	await page.goto(signupPath);

	// The submit fires the form POST; capture the request that goes to the signup
	// endpoint (Astro may serve `/signup/` from a `/signup` POST, so match either).
	const postPromise = page.waitForRequest(
		(req) => req.method() === 'POST' && /\/signup\/?$/.test(new URL(req.url()).pathname),
	);

	await page.getByLabel('Email').fill(EMAIL);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();

	return postPromise;
}

test.describe('auth signup in a real browser', () => {
	// globalSetup already emptied users once; reset before EACH case so both the
	// `/signup` and `/signup/` runs are a deterministic first signup.
	test.beforeEach(() => {
		resetUsers();
	});

	for (const signupPath of ['/signup', '/signup/']) {
		test(`first signup via ${signupPath} navigates and lands signed in`, async ({ page }) => {
			const signupPost = await submitSignup(page, signupPath);

			// The pin: the auth POST is a real document navigation, NOT a
			// client-router fetch (data-astro-reload opted it out of <ClientRouter />).
			expect(signupPost.resourceType()).toBe('document');
			expect(signupPost.isNavigationRequest()).toBe(true);

			// Lands on the (now-unlocked) homepage…
			await page.waitForURL('**/');
			expect(new URL(page.url()).pathname).toBe('/');

			// …and the signed-in masthead renders the Sign out control.
			await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

			// Local D1 has exactly one row for this email — the real signup ran,
			// through real cookies/session/redirects, against the same DB the dev
			// server uses.
			const rows = d1Query<{ n: number }>(
				`SELECT COUNT(*) AS n FROM users WHERE email = '${EMAIL}'`,
			);
			expect(rows[0]?.n).toBe(1);
			const total = d1Query<{ n: number }>('SELECT COUNT(*) AS n FROM users');
			expect(total[0]?.n).toBe(1);
		});
	}
});
