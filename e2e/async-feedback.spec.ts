import { test, expect, type Page } from '@playwright/test';
import { d1Query, resetUsers } from './d1';

// Browser e2e for the async-feedback enhancement (issue #96). vitest renders the
// .astro server-side and never runs the client <script> blocks (the Container API
// doesn't execute client scripts and the worker pool doesn't render Astro), so
// the disable-on-submit / busy-label / "Working…" behavior is e2e-only. The
// markup hooks the scripts read (data-auth-submit, data-busy-label,
// data-read-form, data-read-working, the disabled:* utilities) are pinned in the
// vitest node project; THIS spec verifies the scripts actually flip them in a
// real browser. Progressive enhancement is preserved by design — the no-JS POST
// path is unchanged and is the source of truth; these scripts only LAYER feedback.

const EMAIL = 'connor@couetil.com'; // the default signup allowlist (issue #76)
const PASSWORD = 'correct-horse-battery'; // >= 8 chars, a valid password

// The signup + sign-out forms carry data-astro-reload, so a real submit is a full
// document navigation that tears down the DOM before the in-flight button can be
// observed (and the existing e2e/auth-signup.spec.ts already pins that navigation
// + the first-signup flow). To assert the CLIENT enhancement deterministically we
// suppress only the navigation — the submit event (and our listener) still fires,
// so the disable + label-swap are observable on the still-mounted page. The no-JS
// path and the server write remain the source of truth, untouched by this.
async function suppressNavigation(page: Page): Promise<void> {
	await page.evaluate(() => {
		for (const form of document.querySelectorAll('form')) {
			form.addEventListener('submit', (e) => e.preventDefault());
		}
	});
}

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

test.describe('async-feedback UX in a real browser (#96)', () => {
	test.beforeEach(() => {
		resetUsers();
	});

	test('auth submit goes busy + disabled on submit, swapping to the present-tense label', async ({
		page,
	}) => {
		await page.goto('/signup');
		await suppressNavigation(page);

		await page.getByLabel('Email').fill(EMAIL);
		await page.getByLabel('Password').fill(PASSWORD);
		await page.getByRole('button', { name: 'Create account' }).click();

		// In-flight: disabled, aria-busy, and the label swapped to present tense.
		const busy = page.getByRole('button', { name: 'Creating account…' });
		await expect(busy).toBeDisabled();
		await expect(busy).toHaveAttribute('aria-busy', 'true');
	});

	test('sign-out goes busy + disabled on submit', async ({ page }) => {
		await signUp(page);
		await suppressNavigation(page);

		await page.getByRole('button', { name: 'Sign out' }).click();
		const busy = page.getByRole('button', { name: 'Signing out…' });
		await expect(busy).toBeDisabled();
		await expect(busy).toHaveAttribute('aria-busy', 'true');
	});

	test('read/unread toggle disables the square and reveals "Working…" on submit', async ({
		page,
	}) => {
		// Seed one item BEFORE any page load so the dev server's D1 binding sees it on
		// the first render (avoids racing a CLI write against an already-open workerd
		// D1 connection). The dev server and `wrangler d1 execute --local` share the
		// same .wrangler/state/v3/d1 persistence, so this row is in the same DB the
		// browser reads. Also clear any leftover read state so the row is unread.
		d1Query('DELETE FROM items');
		d1Query('DELETE FROM item_reads');
		d1Query(
			`INSERT INTO items (source, guid, url, title, fetched_at)
			 VALUES ('cloudflare-blog', 'e2e-async', 'https://example.com/async', 'An e2e headline', 1000)`,
		);

		await signUp(page);

		// The read/unread form has NO data-astro-reload, so <ClientRouter /> handles
		// it as an in-page fetch (no full navigation) — exactly the case the loading
		// affordance is for. Hold the POST so the in-flight state is observable
		// before the client-router swap re-renders the row.
		await page.route('**/api/read', async (route) => {
			await new Promise((r) => setTimeout(r, 800));
			await route.continue();
		});

		const square = page.getByRole('button', { name: 'Mark as read' });
		await expect(square).toBeVisible();
		const working = page.getByText('Working…');
		await expect(working).toBeHidden(); // hidden at rest

		await square.click();

		// In-flight: the square is disabled (client layer of the double-submit
		// defense) and the in-voice "Working…" agate line is revealed.
		await expect(square).toBeDisabled();
		await expect(working).toBeVisible();

		await page.unroute('**/api/read');
		// Completion: the server write lands and the row re-renders read (the toggle
		// flips to "Mark as unread"). The /api/read write is idempotent server-side,
		// so the no-JS double-POST path is harmless too.
		await expect(page.getByRole('button', { name: 'Mark as unread' })).toBeVisible();
	});
});
