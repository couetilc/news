import { test, expect, type Page } from '@playwright/test';
import { d1Query, resetUsers } from './d1';

// Browser e2e for the ClientRouter-safe read-toggle enhancement (issue #155).
//
// The bug this pins: a TAB SWITCH is a navigation Astro's <ClientRouter /> handles
// by swapping <main> for fresh server-rendered DOM. The original enhancement bound
// a submit listener once, per-form, at module-execution time — so a form rendered
// into the swapped-in panel had no listener and its toggle ran silently. The fix is
// a single delegated `submit` listener on `document` (src/scripts/enhance-forms.ts),
// which survives the swap.
//
// This spec is the red→green pin: it would FAIL on the old per-form binding (the
// post-swap toggle's busy + in-place update never happen) and PASSES with the
// delegated listener. The companion e2e/async-feedback.spec.ts covers the FIRST
// toggle's feedback; this one specifically asserts the SECOND, post-swap toggle is
// still enhanced. (The toggle itself now updates the row in place rather than
// navigating — #223; e2e/read-toggle-scroll.spec.ts pins the scroll preservation.)
//
// Progressive enhancement is untouched: the no-JS POST → 303 → reload remains the
// source of truth and the /api/read write is idempotent both ways; this only
// asserts the JS enhancement keeps working after a client-router swap.

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

		// Hold every /api/read POST ~800ms (one handler for the whole test) so each
		// toggle's in-flight state is observable before the in-place update (#223)
		// removes the row. It still continues, so completion lands within the
		// assertion timeout.
		await page.route('**/api/read', async (route) => {
			await new Promise((r) => setTimeout(r, 800));
			await route.continue();
		});

		const working = page.getByText('Working…');

		// --- First toggle (mark as read) on the Unread tab. ---
		const markRead = page.getByRole('button', { name: 'Mark as read' });
		await expect(markRead).toBeVisible();
		await expect(working).toBeHidden(); // hidden at rest

		await markRead.click();
		await expect(markRead).toBeDisabled();
		await expect(working).toBeVisible();

		// Completion: under the tabs model (#151) the now-read row leaves the Unread
		// tab IN PLACE (#223 — no navigation), which shows its caught-up empty state.
		// The read item is persisted server-side, so it lives on the Read tab now.
		await expect(page.getByText('All caught up — nothing unread.')).toBeVisible();

		// Switch to the Read tab. The tab link is a normal navigation that
		// <ClientRouter /> intercepts and swaps <main> for — exactly the DOM swap that
		// stranded the OLD per-form binding (#155): the "Mark as unread" form below is
		// freshly server-rendered into the swapped-in panel, never the one present at
		// module-execution time.
		await page.getByRole('link', { name: /^Read/ }).click();
		await expect(page).toHaveURL(/[?&]tab=read/);

		const markUnread = page.getByRole('button', { name: 'Mark as unread' });
		await expect(markUnread).toBeVisible();
		await expect(working).toBeHidden(); // the swapped-in row's line is at rest

		// --- Second toggle (mark as unread) on the POST-SWAP form. ---
		// The regression assertion: with the old per-form binding the swapped-in form
		// had no listener, so nothing below would ever become true. The single
		// document-level delegated listener (#155) survives the swap, so it does.
		await markUnread.click();
		await expect(markUnread).toBeDisabled();
		await expect(working).toBeVisible();

		// Release: the unmark write lands and the in-place update (#223) removes the
		// row from the Read tab — its now-empty state shows (the item moved back to
		// Unread), with no navigation. The /api/read write is idempotent server-side,
		// so the no-JS double-POST path stays harmless too.
		await expect(page.getByText('Nothing read yet.')).toBeVisible();
	});
});
