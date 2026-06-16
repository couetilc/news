import { test, expect, type Page } from '@playwright/test';
import { d1Query, resetUsers } from './d1';

// Browser e2e for the ClientRouter-safe read-toggle enhancement (issue #155).
//
// The bug this pins: the read/unread form is handled by Astro's <ClientRouter />,
// which after each toggle swaps the row/form for fresh server-rendered DOM. The
// original enhancement bound a submit listener once, per-form, at module-execution
// time — so the FIRST toggle showed the async feedback (disable + aria-busy +
// "Working…") but the swapped-in REPLACEMENT form had no listener, and the SECOND
// toggle submitted silently. The fix is a single delegated `submit` listener on
// `document` (src/scripts/enhance-forms.ts), which survives the swap.
//
// This spec is the red→green pin: it would FAIL on the old per-form binding (the
// second toggle's busy state never appears) and PASSES with the delegated
// listener. The companion e2e/async-feedback.spec.ts covers the FIRST toggle's
// feedback; this one specifically asserts the SECOND, post-swap toggle.
//
// Progressive enhancement is untouched: the no-JS POST → 303 → reload remains the
// source of truth and the /api/read write is idempotent both ways; this only
// asserts the JS feedback layer keeps working after a client-router swap.

const EMAIL = 'connor@couetil.com'; // the default signup allowlist (issue #76)
const PASSWORD = 'correct-horse-battery'; // >= 8 chars, a valid password

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

test.describe('read-toggle async feedback survives ClientRouter swaps (#155)', () => {
	test.beforeEach(() => {
		resetUsers();
	});

	test('the replacement form after a swap still goes busy on the next toggle', async ({ page }) => {
		// Seed one unread item BEFORE any page load so the dev server's D1 binding
		// sees it on the first render (the dev server and `wrangler d1 execute
		// --local` share the same .wrangler/state/v3/d1 persistence). Clear any
		// leftover read state so the row starts unread.
		d1Query('DELETE FROM items');
		d1Query('DELETE FROM item_reads');
		d1Query(
			`INSERT INTO items (source, guid, url, title, fetched_at)
			 VALUES ('cloudflare-blog', 'e2e-rebind', 'https://example.com/rebind', 'A rebind headline', 1000)`,
		);

		await signUp(page);

		// Hold every /api/read POST ~800ms so the in-flight (pre-swap) state is
		// observable before the client-router re-renders the row.
		await page.route('**/api/read', async (route) => {
			await new Promise((r) => setTimeout(r, 800));
			await route.continue();
		});

		const working = page.getByText('Working…');

		// --- First toggle (mark as read): the original binding handles this fine. ---
		const markRead = page.getByRole('button', { name: 'Mark as read' });
		await expect(markRead).toBeVisible();
		await expect(working).toBeHidden(); // hidden at rest

		await markRead.click();
		await expect(markRead).toBeDisabled();
		await expect(working).toBeVisible();

		// ClientRouter swaps in the fresh, server-rendered READ row: the toggle now
		// reads "Mark as unread". THIS replacement form is where the old per-form
		// binding was lost.
		const markUnread = page.getByRole('button', { name: 'Mark as unread' });
		await expect(markUnread).toBeVisible();
		// The swapped-in row's "Working…" line is back at rest (hidden) — proving we
		// are looking at the fresh replacement DOM, not the in-flight first row.
		await expect(working).toBeHidden();

		// --- Second toggle (mark as unread) on the REPLACEMENT form. ---
		// This is the regression assertion: with the old per-form binding the
		// replacement had no listener, so nothing below would ever become true.
		await markUnread.click();
		await expect(markUnread).toBeDisabled();
		await expect(working).toBeVisible();

		// Release: the unmark write lands and the row re-renders unread again
		// (completion confirmation). The /api/read write is idempotent server-side,
		// so the no-JS double-POST path stays harmless too.
		await page.unroute('**/api/read');
		await expect(page.getByRole('button', { name: 'Mark as read' })).toBeVisible();
	});
});
