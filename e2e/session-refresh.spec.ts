import { test, expect, type Page } from '@playwright/test';
import { resetUsers } from './d1';

// Browser e2e for the sliding session refresh (issue #320, PR #315 follow-up).
//
// Why this exists: src/middleware.ts#onRequest calls refreshSession on every
// authenticated request so activity slides the 2-week cookie window forward.
// The persistence half of #314 is pinned by e2e/auth-signup.spec.ts (the cookie
// carries a real Expires at login); the SLIDING half is covered only by unit
// stubs — test/middleware.test.ts asserts `session.set` is called and
// test/logout-endpoint.test.ts asserts refreshSession sets without regenerating,
// but neither drives a real authenticated browser request and proves Astro
// actually emits a refreshed Set-Cookie with a later expiry. A regression in
// framework integration (Astro no longer re-issuing the cookie on set),
// middleware wiring, or cookie config would leave those units green while
// active users silently stop getting their expiry extended. This spec closes
// that gap through the real Playwright server path.

const EMAIL = 'connor@couetil.com'; // the default signup allowlist (issue #76)
const PASSWORD = 'correct-horse-battery'; // >= 8 chars, a valid password

// First-signup flow, mirroring e2e/auth-signup.spec.ts: globalSetup empties the
// users table (and resetUsers below re-empties it per test), so a fresh signup
// is the established way to reach an authenticated session.
async function signUp(page: Page): Promise<void> {
	await page.goto('/signup');
	await page.getByLabel('Email').fill(EMAIL);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Create account' }).click();
	await page.waitForURL('**/');
}

// Read the astro-session cookie from the context, asserting it exists.
async function sessionCookie(page: Page) {
	const cookies = await page.context().cookies();
	const session = cookies.find((c) => c.name === 'astro-session');
	expect(session, 'expected an astro-session cookie').toBeTruthy();
	return session!;
}

test.describe('sliding session refresh in a real browser (#314/#320)', () => {
	test.beforeEach(() => {
		resetUsers();
	});

	test('authenticated activity re-issues the session cookie with a later expiry', async ({
		page,
	}) => {
		await signUp(page);

		const before = await sessionCookie(page);
		// Sanity: the login cookie is persistent (the #314 baseline this spec
		// slides forward). Playwright reports a bare session cookie as -1.
		expect(before.expires).not.toBe(-1);

		// Cookie Expires/Max-Age has one-second precision, so wait just over a
		// second — otherwise a genuinely refreshed cookie could round to the same
		// timestamp and the strict > assertion below would flake.
		await page.waitForTimeout(1100);

		// Any authenticated page request goes through the middleware gate and must
		// slide the window forward.
		await page.reload();

		const after = await sessionCookie(page);
		// Still not a bare browser-session cookie after the refresh…
		expect(after.expires).not.toBe(-1);
		// …and the refresh actually happened: the new expiry is STRICTLY later
		// than the one recorded at login. This is the #320 pin — it fails if the
		// middleware stops re-recording the session or Astro stops re-issuing the
		// cookie on set.
		expect(after.expires).toBeGreaterThan(before.expires);

		// The refreshed window is still ~14 days out (same tolerance math as
		// auth-signup.spec.ts), so this also catches an accidental lifetime change
		// — a refresh to the wrong maxAge would slide the window but land outside
		// these bounds.
		const secondsUntilExpiry = after.expires - Date.now() / 1000;
		const fourteenDays = 60 * 60 * 24 * 14;
		expect(secondsUntilExpiry).toBeGreaterThan(fourteenDays - 60 * 60 * 24);
		expect(secondsUntilExpiry).toBeLessThanOrEqual(fourteenDays + 60);
		// httpOnly is preserved across the refresh (Astro forces it).
		expect(after.httpOnly).toBe(true);
	});
});
