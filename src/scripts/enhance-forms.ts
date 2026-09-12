import { parseCursor } from '../lib/pagination';

// Shared progressive-enhancement initializer for the project's form async
// feedback (#96), made ClientRouter-safe (#155), with the read/unread toggle
// upgraded to an in-place update that preserves scroll (#223).
//
// Why delegation, not per-form binding: the read/unread toggle's row is swapped
// by Astro's <ClientRouter /> (Layout.astro) on any in-app navigation (a tab
// switch), and the auth/sign-out scripts shared the same one-shot pattern. A
// listener bound once, per-form, at module-execution time goes stale on the
// freshly server-rendered replacement markup (#155). One delegated `submit`
// listener on `document` (which ClientRouter never replaces) finds the relevant
// form/control at event time, so it keeps working across every DOM swap without
// rebinding. This is the shared, reusable enhancement path siblings (#95, #150)
// build on.
//
// Progressive enhancement is preserved: the no-JS POST → 303 → reload path is
// untouched and remains the source of truth; this only LAYERS behavior when JS
// is present. Each enhanced markup is opt-in via data-* hooks, so an unenhanced
// form on the page is simply ignored.
//
// The read toggle (#223): with JS off the form POSTs and the server 303-redirects
// back to the active tab re-rendered from page one, which snaps the browser to
// the top — fine as the no-JS source of truth, wrong UX while reading down a long
// feed. So with JS on the listener INTERCEPTS the read-form submit, `fetch`es the
// POST itself (no browser/ClientRouter navigation), and updates the row in place:
// a toggled item leaves the tab it was on, so its <li data-feed-row> is removed
// and both tab tallies are re-counted. A Recently viewed toggle instead moves
// a matching source back into the unread window, all without navigation — the reader's
// scroll position is undisturbed. The auth/sign-out submits keep their original
// "layer busy feedback, then let the real navigation happen" behavior.
//
// Astro's client pipeline builds this for the browser, but it's pure DOM logic,
// so it's unit-tested in the node project under a per-file happy-dom environment
// (test/browser/enhance-forms.test.ts) and stays inside the 100% src/** istanbul gate.
// The Playwright e2e (e2e/read-toggle-scroll.spec.ts, e2e/async-feedback.spec.ts,
// e2e/read-toggle-rebind.spec.ts) additionally covers it as a real-browser guard.

// Mark a triggering button busy in voice (#96): disabled (client layer of the
// double-submit defense), aria-busy for assistive tech, and — when it carries a
// present-tense data-busy-label (auth submit, sign out) — its visible label
// swapped to that label. The read square has no label to swap, so it just goes
// disabled + aria-busy (its :disabled utilities dim it).
function markButtonBusy(button: HTMLButtonElement): void {
	button.disabled = true;
	button.setAttribute('aria-busy', 'true');
	const busy = button.dataset.busyLabel;
	if (busy) {
		button.textContent = busy;
	}
}

// Undo markButtonBusy after a failed in-place read toggle so the reader can retry
// the square. The read square has no busy-label to restore (it never swapped one),
// so this only re-enables it and drops aria-busy.
function restoreButton(button: HTMLButtonElement): void {
	button.disabled = false;
	button.removeAttribute('aria-busy');
}

// Reveal the in-voice italic agate "Working…" line where the read-toggle result
// will land (#96) — hidden + aria-hidden at rest, shown and announced in flight.
//
// Also RESET the slot back to the loading state before each fetch (#251): a prior
// failed toggle left this same line as an error (role="alert", text-accent, the
// "Couldn’t save" copy — see showReadError). On the retry that error must not
// linger next to a busy square, so restore the in-flight affordance: the
// "Working…" text, no alert role, and the normal muted ink rather than the accent.
// At rest the line already carries this state, so resetting it is a harmless no-op
// on a first, never-failed toggle.
function revealWorking(form: HTMLFormElement): void {
	const working = form.querySelector<HTMLElement>('[data-read-working]');
	if (working) {
		working.hidden = false;
		working.removeAttribute('aria-hidden');
		working.removeAttribute('role');
		working.classList.remove('text-accent');
		working.textContent = 'Working…';
	}
}

// Surface a network/system error from the in-place toggle in voice, where the
// "Working…" line was (#96, design-system "Surface errors"): never swallow an
// async failure. Repurposes the same agate slot — announces it as a role="alert"
// in the accent ink — so the reader sees the toggle didn't take and can retry.
function showReadError(form: HTMLFormElement): void {
	const working = form.querySelector<HTMLElement>('[data-read-working]');
	if (working) {
		working.hidden = false;
		working.removeAttribute('aria-hidden');
		working.setAttribute('role', 'alert');
		working.classList.add('text-accent');
		working.textContent = 'Couldn’t save — try again.';
	}
}

// Re-tally both feed tabs after a row moves between them (#223). The toggled row
// leaves its current tab and joins the other, so the joined tab gains one and the
// left tab loses one. `nowRead` is the row's NEW state: read→it joined Read and
// left Unread, unread→the reverse. Counts can't go negative in practice (the row
// being toggled is itself in the left tab's tally), but Math.max guards a stale
// DOM rather than rendering a "-1". A tally span absent from the DOM (no FeedTabs,
// e.g. a bare test form) is simply skipped.
function bumpTally(which: 'unread' | 'read', delta: number): void {
	const span = document.querySelector<HTMLElement>(`[data-tab-count="${which}"]`);
	if (span) {
		// String() handles both a numeric tally and a null/empty textContent (→ "null"
		// or "" → NaN → base 0) in one branch-free expression; a stale/non-numeric
		// tally just restarts from 0 rather than rendering a "NaN".
		const current = Number.parseInt(String(span.textContent), 10);
		const base = Number.isNaN(current) ? 0 : current;
		span.textContent = String(Math.max(0, base + delta));
	}
}

function retallyTabs(nowRead: boolean): void {
	if (nowRead) {
		bumpTally('read', 1);
		bumpTally('unread', -1);
	} else {
		bumpTally('unread', 1);
		bumpTally('read', -1);
	}
}

// Remove the toggled row from the active tab's list, keep its infinite-scroll
// boundary unchanged, and — only when the tab is truly exhausted — replace the list
// with the same caught-up empty state the server renders (#223, #249). The empty
// copy rides on the <ol data-feed-list data-empty-message> (filter- and tab-aware,
// computed server-side), so the client never reconstructs it. The <p>'s classes
// mirror the server-rendered <p data-feed-empty> in index.astro — keep them in
// sync. A form not inside a [data-feed-row] (a bare test form) has no row to
// remove, so this is a no-op there.
function removeRow(form: HTMLFormElement): void {
	const row = form.closest<HTMLElement>('[data-feed-row]');
	if (!row) return;
	const list = row.closest<HTMLElement>('[data-feed-list]');
	row.remove();
	if (!list) return;
	// The tab is caught up only when NO row remains AND no sentinel is left to load
	// more behind it — otherwise more pages exist and an empty state would be false
	// (#249). When truly empty, swap the whole list for its empty-state paragraph.
	const hasRow = list.querySelector('[data-feed-row]') !== null;
	const hasSentinel = list.querySelector('[data-feed-sentinel]') !== null;
	if (!hasRow && !hasSentinel) {
		const empty = document.createElement('p');
		empty.setAttribute('data-feed-empty', '');
		empty.className = 'py-16 text-center text-lg italic text-muted';
		empty.textContent = list.dataset.emptyMessage ?? '';
		if (list.querySelector('[data-read-receipt]')) list.parentNode!.insertBefore(empty, list.nextSibling);
		else list.replaceWith(empty);
	}
}

// A global Recently viewed item can return to a filtered unread list. Reuse
// its existing Article DOM so labels, the form, and the small read square stay
// consistent, and insert using the same timestamp/id ordering as the D1 query.
// Rows beyond a partially loaded window stay for its next page; inserting one
// inside the window leaves its stable cursor unchanged.
function returnRecentRow(form: HTMLFormElement, lane: HTMLElement): void {
	const row = form.closest<HTMLElement>('[data-feed-row]')!;
	const inActiveFeed = row.dataset.activeFeed !== 'false';
	row.remove();
	const remaining = lane.querySelectorAll('[data-feed-row]').length;
	if (remaining === 0) lane.remove();
	else lane.querySelector<HTMLElement>('[data-recent-count]')!.textContent = String(remaining);
	if (!inActiveFeed) return;

	retallyTabs(false);
	let list = document.querySelector<HTMLElement>('[data-feed-list]');
	if (!list) {
		const empty = document.querySelector<HTMLElement>('[data-feed-empty]')!;
		list = document.createElement('ol');
		list.setAttribute('data-feed-list', '');
		list.dataset.emptyMessage = empty.textContent!.trim();
		empty.replaceWith(list);
	}
	const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-feed-row]'));
	const nextRow = rows.find((other) =>
		Number(other.dataset.sortTime) < Number(row.dataset.sortTime) ||
		(Number(other.dataset.sortTime) === Number(row.dataset.sortTime) &&
			Number(other.dataset.itemId) < Number(row.dataset.itemId)),
	);
	const sentinel = list.querySelector<HTMLElement>('[data-feed-sentinel]');
	// Compare with the served boundary even if its row has since been removed.
	// Older rows belong to a future page; newer rows must rejoin this window.
	if (sentinel) {
		const cursor = parseCursor(new URL(sentinel.dataset.nextUrl!, 'https://news.cuteteal.com').searchParams.get('cursor'))!;
		const time = Number(row.dataset.sortTime);
		if (time < cursor.time || (time === cursor.time && Number(row.dataset.itemId) < cursor.id)) return;
	}

	row.dataset.readState = 'unread';
	row.dataset.swipeRead = '';
	form.querySelector<HTMLInputElement>('[name="read"]')!.value = '1';
	const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
	button.setAttribute('aria-label', 'Mark as read');
	restoreButton(button);
	const working = form.querySelector<HTMLElement>('[data-read-working]')!;
	working.hidden = true;
	working.setAttribute('aria-hidden', 'true');
	document.querySelector('[data-feed-empty]')?.remove();
	list.insertBefore(row, nextRow ?? sentinel);
}

// Keep the latest completed read action undoable beside the dismissed row.
// Pending Undo writes retain their receipt even if another read completes.
const undoRows = new WeakMap<HTMLFormElement, HTMLElement>();
const pendingForms = new WeakSet<HTMLFormElement>();

function offerReadUndo(form: HTMLFormElement, focus: boolean): void {
	const row = form.closest<HTMLElement>('[data-feed-row]');
	const list = row?.closest<HTMLElement>('[data-feed-list]');
	if (!row || !list || !row.hasAttribute('data-swipe-read')) return;
	for (const old of list.querySelectorAll<HTMLElement>('[data-read-receipt]')) {
		if (!old.querySelector('button:disabled')) old.remove();
	}
	const receipt = document.createElement('li');
	receipt.dataset.readReceipt = '';
	receipt.className = 'flex items-center justify-between gap-3 border-b border-rule py-1 font-sans text-xs text-muted';
	const message = document.createElement('span');
	message.setAttribute('role', 'status');
	message.textContent = 'Marked as read.';
	const undo = form.cloneNode(true) as HTMLFormElement;
	undo.className = 'flex items-center gap-2';
	undo.dataset.readUndo = '';
	undo.querySelector<HTMLInputElement>('[name="read"]')!.value = '0';
	const button = undo.querySelector<HTMLButtonElement>('button[type="submit"]')!;
	button.className = 'min-h-11 cursor-pointer px-2 underline underline-offset-2 hover:text-accent focus-visible:outline-2 focus-visible:outline-ink';
	button.textContent = 'Undo';
	button.setAttribute('aria-label', `Undo marking ${row.querySelector('h2')!.textContent!.trim()} as read`);
	restoreButton(button);
	undo.querySelector<HTMLElement>('[data-read-working]')!.hidden = true;
	undoRows.set(undo, row);
	receipt.appendChild(message);
	receipt.appendChild(undo);
	list.insertBefore(receipt, row);
	// Transfer keyboard focus only when the removed row owned it. Swipes do
	// not move focus or scroll back up to a distant page-level notification.
	if (focus) button.focus({ preventScroll: true });
}

function restoreUndoRow(form: HTMLFormElement, row: HTMLElement, focus: boolean): void {
	const receipt = form.closest<HTMLElement>('[data-read-receipt]')!;
	const button = row.querySelector<HTMLButtonElement>('button[type="submit"]')!;
	restoreButton(button);
	const working = row.querySelector<HTMLElement>('[data-read-working]')!;
	working.hidden = true;
	working.setAttribute('aria-hidden', 'true');
	receipt.replaceWith(row);
	document.querySelector('[data-feed-empty]')?.remove();
	if (focus) button.focus({ preventScroll: true });
	retallyTabs(false);
}

// Disabling a focused button blurs it in Chromium. Remember its ownership,
// but do not reclaim focus after the reader has deliberately moved elsewhere.
function mayRestoreFocus(form: HTMLFormElement, ownedFocus: boolean): boolean {
	return ownedFocus && (form.querySelector('button[type="submit"]') === document.activeElement || document.activeElement === document.body);
}

// POST in place; a followed redirect away from the homepage means the session
// expired. Leave the DOM unchanged and navigate to the real login flow.
async function submitReadForm(
	form: HTMLFormElement,
	button: HTMLButtonElement | null,
	ownedFocus: boolean,
): Promise<void> {
	const nowRead = new FormData(form).get('read') === '1';
	try {
		const res = await fetch(form.action, {
			method: 'POST',
			body: new FormData(form),
		});
		if (!res.ok) throw new Error(`read toggle ${res.status}`);
		// A followed auth-redirect lands here as a 200 whose final URL is no longer
		// the feed (/login). Don't treat it as a saved toggle — navigate to the login
		// flow and leave the row/tallies untouched (#250).
		if (res.redirected && new URL(res.url).pathname !== '/') {
			window.location.assign(res.url);
			return;
		}
		// A tab/filter navigation can replace this form while the write is pending.
		// Its response must not change the newly selected view.
		if (!form.isConnected) return;
		const lane = form.closest<HTMLElement>('[data-recently-viewed]');
		const undoRow = undoRows.get(form);
		if (undoRow) restoreUndoRow(form, undoRow, mayRestoreFocus(form, ownedFocus));
		else if (lane) returnRecentRow(form, lane);
		else {
			if (nowRead) offerReadUndo(form, mayRestoreFocus(form, ownedFocus));
			removeRow(form);
			retallyTabs(nowRead);
		}
		// Refetch an in-flight fragment after any local mutation: it may contain
		// an old read state even though the timestamp/id boundary is still valid.
		const list = document.querySelector<HTMLElement>('[data-feed-list]');
		if (list) list.dataset.feedRevision = String(Number(list.dataset.feedRevision ?? 0) + 1);
	} catch {
		if (button) {
			restoreButton(button);
			if (mayRestoreFocus(form, ownedFocus)) button.focus({ preventScroll: true });
		}
		showReadError(form);
	} finally {
		pendingForms.delete(form);
	}
}

// Handle one submit anywhere on the page. Enhancement is OPT-IN by data-* hook,
// so a plain form (none today, but a future GET search form etc.) is untouched:
//   - data-read-form  → intercept: reveal "Working…", disable the square, then
//                       fetch the POST and update the row in place (#223)
//   - data-busy-label → disable + swap to the busy label, then let the real
//                       navigation happen (auth submit, sign out)
// A sibling enhancement (#95, #150) opts in the same way — add its hook here.
function onSubmit(event: SubmitEvent): void {
	const form = event.target;
	if (!(form instanceof HTMLFormElement)) {
		return;
	}

	// The control that triggered the submit (the submitter) if the browser
	// reported it, otherwise the form's submit button.
	const submitter = event.submitter;
	const button =
		submitter instanceof HTMLButtonElement
			? submitter
			: form.querySelector<HTMLButtonElement>('button[type="submit"]');

	const isReadForm = form.hasAttribute('data-read-form');
	const hasBusyLabel = button?.dataset.busyLabel !== undefined;
	if (!isReadForm && !hasBusyLabel) {
		// Not one of our enhanced forms — leave it as a plain POST.
		return;
	}

	if (isReadForm) {
		// Take over the submit: no browser/ClientRouter navigation, so scroll stays
		// put (#223). The no-JS path (this never runs) is the source of truth.
		event.preventDefault();
		if (pendingForms.has(form)) return;
		pendingForms.add(form);
		const ownedFocus = button !== null && button === document.activeElement;
		revealWorking(form);
		if (button) {
			markButtonBusy(button);
		}
		void submitReadForm(form, button, ownedFocus);
		return;
	}

	// Auth submit / sign out: layer busy feedback, then let the real navigation
	// (the no-JS POST or its data-astro-reload document submit) carry on. We're here
	// only because hasBusyLabel is true, which is `button?.dataset.busyLabel !==
	// undefined` — so `button` is necessarily non-null. The assertion documents that
	// invariant without an unreachable `if (button)` false branch the 100% gate
	// would flag (mirrors the `return row!` idiom in src/lib/users.ts).
	markButtonBusy(button!);
}

// Bind ONCE on document, in the CAPTURE phase. ClientRouter never replaces
// document, so this single listener survives every page swap (#155). Capture
// matters for the read toggle (#223): <ClientRouter /> registers its own bubble-
// phase submit listener in <head> (before this body <script> runs) and would
// otherwise start a client-router navigation first — its handler only bails on an
// ALREADY-prevented event. Running in capture guarantees this listener fires (and
// calls preventDefault on the read form) before ClientRouter's, so the in-place
// fetch takes over instead of a navigation that snaps scroll to the top. The
// non-read branches don't preventDefault, so the auth/sign-out submits still flow
// to their real (no-JS / data-astro-reload) navigation unchanged.
document.addEventListener('submit', onSubmit, true);
