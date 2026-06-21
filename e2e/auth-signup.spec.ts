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

	test('the session cookie is persistent, not a bare browser-session cookie (#314)', async ({
		page,
	}) => {
		// The #314 acceptance signal: after login the auth cookie must carry a
		// far-future Max-Age/Expires so it survives a (mobile) browser restart,
		// rather than being a session cookie the OS evicts. Playwright reports a
		// bare session cookie as `expires === -1`; a persistent one carries a real
		// epoch timestamp. We assert it lands ~14 days out (the configured maxAge),
		// allowing generous slack for clock + request latency.
		await submitSignup(page, '/signup');
		await page.waitForURL('**/');

		const cookies = await page.context().cookies();
		const session = cookies.find((c) => c.name === 'astro-session');
		expect(session, 'expected an astro-session cookie after login').toBeTruthy();

		// Not a bare session cookie.
		expect(session?.expires).not.toBe(-1);
		const secondsUntilExpiry = (session?.expires ?? 0) - Date.now() / 1000;
		const fourteenDays = 60 * 60 * 24 * 14;
		// Within a day of the 14-day target on either side (covers a slightly
		// shorter window from latency and any minor drift).
		expect(secondsUntilExpiry).toBeGreaterThan(fourteenDays - 60 * 60 * 24);
		expect(secondsUntilExpiry).toBeLessThanOrEqual(fourteenDays + 60);
		// httpOnly is preserved (Astro forces it) so the cookie stays unreadable to JS.
		expect(session?.httpOnly).toBe(true);
	});
});
