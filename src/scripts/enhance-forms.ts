// Shared progressive-enhancement initializer for the project's form async
// feedback (#96), made ClientRouter-safe (#155).
//
// Why delegation, not per-form binding: the read/unread toggle is handled by
// Astro's <ClientRouter /> (Layout.astro). After the first toggle the router
// swaps the row/form for fresh server-rendered DOM, so any listener bound once
// to the *current* form element at module-execution time is lost — the
// replacement form has the data-* hooks and hidden "Working…" markup but no
// listener, so the second toggle submits with no busy state (#155). The
// auth/sign-out scripts shared the same one-shot pattern, so a client-side
// navigation could leave them stale on swapped markup too.
//
// One delegated `submit` listener on `document` sidesteps all of that: the
// listener lives on `document` (which ClientRouter never replaces) and finds the
// relevant form/control at event time, so it keeps working across every DOM swap
// without rebinding. No `astro:page-load` rebind is needed. This is the shared,
// reusable enhancement path siblings (#95, #150) build on.
//
// Progressive enhancement is preserved: the no-JS POST → 303 → reload path is
// untouched and remains the source of truth; this only LAYERS feedback when JS
// is present. Each enhanced markup is opt-in via data-* hooks, so an unenhanced
// form on the page is simply ignored.
//
// This module is built by Astro's client pipeline, not the SSR module graph the
// vitest coverage gate sees, so it is exercised by the Playwright e2e
// (e2e/async-feedback.spec.ts, e2e/read-toggle-rebind.spec.ts), not the 100%
// src/** istanbul gate.

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

// Reveal the in-voice italic agate "Working…" line where the read-toggle result
// will land (#96) — hidden + aria-hidden at rest, shown and announced in flight.
function revealWorking(form: HTMLFormElement): void {
	const working = form.querySelector<HTMLElement>('[data-read-working]');
	if (working) {
		working.hidden = false;
		working.removeAttribute('aria-hidden');
	}
}

// Handle one submit anywhere on the page. Enhancement is OPT-IN by data-* hook,
// so a plain form (none today, but a future GET search form etc.) is untouched:
//   - data-read-form  → reveal "Working…" + disable the square (the read toggle)
//   - data-busy-label → disable + swap to the busy label (auth submit, sign out)
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
		revealWorking(form);
	}
	// Disable the triggering control so a second click can't double-POST (client
	// layer; the server write stays idempotent regardless).
	if (button) {
		markButtonBusy(button);
	}
}

// Bind ONCE on document. ClientRouter never replaces document, so this single
// listener survives every page swap — the whole point of #155.
document.addEventListener('submit', onSubmit);
