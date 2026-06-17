// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit test for the browser-only async-feedback initializer (#155, #96, #223).
// Runs in the node project under a per-file happy-dom environment (see the
// docblock above) so `document`, HTMLFormElement, and submit-event delegation
// resolve — the workerd pool can't host a DOM, so this file is excluded there
// (vitest.workers.config.ts) and included here (vitest.node.config.ts).
//
// Importing the module for its side effect registers the single delegated
// `submit` listener on `document` — exactly what runs in the browser. Every case
// below dispatches a real bubbling submit event so it exercises that registered
// listener (not a hand-called function), which is the behavior #155 guarantees:
// one document-level listener that survives ClientRouter DOM swaps.
//
// The read toggle now INTERCEPTS its submit and `fetch`es the POST itself, then
// updates the row in place so scroll is preserved (#223). So `globalThis.fetch`
// is stubbed (these tests are hermetic — no network), and the read cases assert
// the in-place DOM mutation, not just the busy feedback.
import '../src/scripts/enhance-forms';

// A controllable fetch stub: each test sets `fetchImpl` to resolve a fake
// Response (ok or not) or reject (network error). Defaults to a successful 303-
// followed-to-200, the real /api/read shape (fetch follows the redirect, so the
// toggle sees res.ok). The body is never read by the module.
let fetchImpl: () => Promise<{ ok: boolean; status: number }>;
const fetchSpy = vi.fn(() => fetchImpl());

beforeAll(() => {
	// happy-dom may run a submit event's default action (a real navigation); a
	// capture-phase preventDefault neutralizes it without stopping propagation, so
	// the module's bubble-phase listener still runs. We DON'T pre-prevent read
	// forms, so the read cases can assert the MODULE itself called preventDefault
	// (the #223 interception) — a read form left un-prevented here would navigate
	// only if the module failed to take over, which is exactly what we test for.
	document.addEventListener(
		'submit',
		(e) => {
			if (!(e.target as Element).hasAttribute('data-read-form')) e.preventDefault();
		},
		true,
	);
	vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
	// Re-assert the stub each test in case anything cleared globals.
	vi.stubGlobal('fetch', fetchSpy);
});

beforeEach(() => {
	document.body.innerHTML = '';
	fetchSpy.mockClear();
	fetchImpl = () => Promise.resolve({ ok: true, status: 200 });
});

// Dispatch a bubbling submit on `target`, optionally with an explicit `submitter`
// (the clicked control). A plain Event has no `submitter`, so we define it when a
// test needs the submitter path; left unset, the handler falls back to the form's
// own submit button.
function dispatchSubmit(target: Element, submitter?: HTMLButtonElement): Event {
	const ev = new Event('submit', { bubbles: true, cancelable: true });
	if (submitter !== undefined) {
		Object.defineProperty(ev, 'submitter', { value: submitter, configurable: true });
	}
	target.dispatchEvent(ev);
	return ev;
}

function readWorking(): HTMLElement {
	const working = document.createElement('span');
	working.setAttribute('data-read-working', '');
	working.hidden = true;
	working.setAttribute('aria-hidden', 'true');
	working.textContent = 'Working…';
	return working;
}

// Build a feed list with one row (the homepage shape: an <ol data-feed-list> of
// <li data-feed-row> rows, each with a data-read-form posting the NEXT state).
// `read` is the hidden next-state value the square would carry.
function readRow(read: '0' | '1'): {
	list: HTMLElement;
	row: HTMLElement;
	form: HTMLFormElement;
	button: HTMLButtonElement;
	working: HTMLElement;
} {
	const list = document.createElement('ol');
	list.setAttribute('data-feed-list', '');
	list.dataset.emptyMessage = 'All caught up — nothing unread.';

	const row = document.createElement('li');
	row.setAttribute('data-feed-row', '');

	const form = document.createElement('form');
	form.setAttribute('data-read-form', '');
	form.action = 'https://news.test/api/read';
	form.method = 'POST';

	const id = document.createElement('input');
	id.type = 'hidden';
	id.name = 'id';
	id.value = '7';
	const readField = document.createElement('input');
	readField.type = 'hidden';
	readField.name = 'read';
	readField.value = read;

	const working = readWorking();
	const button = document.createElement('button');
	button.type = 'submit';

	form.append(id, readField, working, button);
	row.append(form);
	list.append(row);
	document.body.append(list);
	return { list, row, form, button, working };
}

// Two tab-tally spans (FeedTabs shape), so the read toggle can re-count them.
function tabTallies(unread: number, read: number): { unread: HTMLElement; read: HTMLElement } {
	const u = document.createElement('span');
	u.setAttribute('data-tab-count', 'unread');
	u.textContent = String(unread);
	const r = document.createElement('span');
	r.setAttribute('data-tab-count', 'read');
	r.textContent = String(read);
	document.body.append(u, r);
	return { unread: u, read: r };
}

// Let queued microtasks (the async submitReadForm → fetch().then chain) settle.
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('enhance-forms — delegated submit feedback (#155)', () => {
	it('ignores a submit whose target is not a form', () => {
		const div = document.createElement('div');
		document.body.append(div);
		// form instanceof HTMLFormElement is false → the handler returns early.
		expect(() => dispatchSubmit(div)).not.toThrow();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('swaps the busy label on an auth/sign-out submit (data-busy-label)', () => {
		const form = document.createElement('form');
		const button = document.createElement('button');
		button.type = 'submit';
		button.dataset.busyLabel = 'Signing in…';
		button.textContent = 'Sign in';
		form.append(button);
		document.body.append(form);

		dispatchSubmit(form, button);

		expect(button.disabled).toBe(true);
		expect(button.getAttribute('aria-busy')).toBe('true');
		expect(button.textContent).toBe('Signing in…');
		// Auth submits are NOT intercepted by the read path: the real navigation
		// (the no-JS POST / data-astro-reload document submit) carries on and no
		// fetch fires. (The capture-phase guard in beforeAll prevents the default
		// here only to keep happy-dom from navigating in the test — the module
		// itself never calls preventDefault on a non-read form.)
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('leaves a plain form (no data hook) untouched', () => {
		const form = document.createElement('form');
		const button = document.createElement('button');
		button.type = 'submit';
		form.append(button);
		document.body.append(form);

		dispatchSubmit(form);

		// Neither data-read-form nor data-busy-label → not one of ours → early out.
		expect(button.disabled).toBe(false);
		expect(button.getAttribute('aria-busy')).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe('enhance-forms — read toggle in-place update preserves scroll (#223)', () => {
	it('intercepts the submit, marks busy + reveals "Working…", and POSTs via fetch', async () => {
		const { form, button, working } = readRow('1');
		const tallies = tabTallies(3, 2);

		const ev = dispatchSubmit(form, button);

		// Navigation is prevented — no browser/ClientRouter nav, so scroll stays put.
		expect(ev.defaultPrevented).toBe(true);
		// Busy feedback: disabled, aria-busy, "Working…" revealed (no label to swap).
		expect(button.disabled).toBe(true);
		expect(button.getAttribute('aria-busy')).toBe('true');
		expect(button.textContent).toBe('');
		expect(working.hidden).toBe(false);
		expect(working.getAttribute('aria-hidden')).toBeNull();
		// POSTed to the form's own action with the read FormData.
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://news.test/api/read');
		expect(init.method).toBe('POST');
		expect(init.body).toBeInstanceOf(FormData);
		expect((init.body as FormData).get('read')).toBe('1');

		await flush();

		// Success: the row is removed (it left the Unread tab), tallies re-counted.
		expect(document.querySelector('[data-feed-row]')).toBeNull();
		expect(tallies.unread.textContent).toBe('2'); // 3 → 2 (left Unread)
		expect(tallies.read.textContent).toBe('3'); // 2 → 3 (joined Read)
	});

	it('marking unread moves the row the other way (read→unread tallies)', async () => {
		const { form, button } = readRow('0');
		const tallies = tabTallies(4, 5);

		dispatchSubmit(form, button);
		await flush();

		expect(document.querySelector('[data-feed-row]')).toBeNull();
		expect(tallies.unread.textContent).toBe('5'); // 4 → 5 (joined Unread)
		expect(tallies.read.textContent).toBe('4'); // 5 → 4 (left Read)
	});

	it('falls back to the form submit button when no submitter is reported', async () => {
		const { form, button, working } = readRow('1');
		tabTallies(1, 0);

		// No submitter on the event → the handler queries button[type="submit"].
		dispatchSubmit(form);

		expect(button.disabled).toBe(true);
		expect(working.hidden).toBe(false);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		await flush();
		expect(document.querySelector('[data-feed-row]')).toBeNull();
	});

	it('renders the tab empty state when the last row is toggled away', async () => {
		const { list, form, button } = readRow('1');
		tabTallies(1, 0);

		dispatchSubmit(form, button);
		await flush();

		// The list is now empty → swapped for the server's caught-up <p>.
		expect(document.querySelector('[data-feed-list]')).toBeNull();
		const empty = document.querySelector<HTMLElement>('[data-feed-empty]');
		expect(empty).not.toBeNull();
		expect(empty?.textContent).toBe('All caught up — nothing unread.');
		// The empty <p> matches the server-rendered classes (index.astro).
		expect(empty?.className).toBe('py-16 text-center text-lg italic text-muted');
		// The original <ol> is gone, replaced (not merely emptied).
		expect(list.isConnected).toBe(false);
	});

	it('uses an empty message of "" when the list carries none', async () => {
		const { list, form, button } = readRow('1');
		delete list.dataset.emptyMessage; // no data-empty-message present
		tabTallies(1, 0);

		dispatchSubmit(form, button);
		await flush();

		const empty = document.querySelector<HTMLElement>('[data-feed-empty]');
		expect(empty).not.toBeNull();
		expect(empty?.textContent).toBe('');
	});

	it('leaves the list in place (and other rows) when more rows remain', async () => {
		const { list, form, button } = readRow('1');
		// A second row that should survive the first one being toggled away.
		const otherRow = document.createElement('li');
		otherRow.setAttribute('data-feed-row', '');
		list.append(otherRow);

		dispatchSubmit(form, button);
		await flush();

		// The toggled row is gone; the list and the surviving row remain.
		expect(list.isConnected).toBe(true);
		expect(list.querySelectorAll('[data-feed-row]').length).toBe(1);
		expect(document.querySelector('[data-feed-empty]')).toBeNull();
	});

	it('on a non-ok response restores the square and shows an inline error', async () => {
		fetchImpl = () => Promise.resolve({ ok: false, status: 500 });
		const { row, form, button, working } = readRow('1');
		tabTallies(3, 2);

		dispatchSubmit(form, button);
		await flush();

		// The write failed: the row stays, the square is re-enabled to retry, and
		// the error is surfaced in voice (role=alert) — never swallowed.
		expect(row.isConnected).toBe(true);
		expect(button.disabled).toBe(false);
		expect(button.getAttribute('aria-busy')).toBeNull();
		expect(working.getAttribute('role')).toBe('alert');
		expect(working.textContent).toBe('Couldn’t save — try again.');
		expect(working.classList.contains('text-accent')).toBe(true);
	});

	it('on a network rejection also restores and shows the error', async () => {
		fetchImpl = () => Promise.reject(new Error('offline'));
		const { row, form, button, working } = readRow('1');

		dispatchSubmit(form, button);
		await flush();

		expect(row.isConnected).toBe(true);
		expect(button.disabled).toBe(false);
		expect(working.getAttribute('role')).toBe('alert');
	});

	it('handles a read form outside any feed list (no row/tallies to touch)', async () => {
		// A bare data-read-form with no enclosing [data-feed-row] / [data-feed-list]
		// and no tally spans — the fetch still fires, the DOM updates are no-ops.
		const form = document.createElement('form');
		form.setAttribute('data-read-form', '');
		form.action = 'https://news.test/api/read';
		const readField = document.createElement('input');
		readField.type = 'hidden';
		readField.name = 'read';
		readField.value = '1';
		const button = document.createElement('button');
		button.type = 'submit';
		form.append(readField, button);
		document.body.append(form);

		dispatchSubmit(form, button);
		await flush();

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		// No row to remove, no tallies to bump — and it didn't throw.
		expect(form.isConnected).toBe(true);
	});

	it('reveals "Working…" even when a read form has no submit button', async () => {
		const list = document.createElement('ol');
		list.setAttribute('data-feed-list', '');
		const row = document.createElement('li');
		row.setAttribute('data-feed-row', '');
		const form = document.createElement('form');
		form.setAttribute('data-read-form', '');
		form.action = 'https://news.test/api/read';
		const readField = document.createElement('input');
		readField.type = 'hidden';
		readField.name = 'read';
		readField.value = '1';
		const working = readWorking();
		form.append(readField, working);
		row.append(form);
		list.append(row);
		document.body.append(list);

		// button resolves to null (no submitter, no submit button): markButtonBusy
		// and restoreButton are skipped, but the read form still reveals "Working…"
		// and runs the in-place update.
		dispatchSubmit(form);
		expect(working.hidden).toBe(false);
		await flush();
		expect(row.isConnected).toBe(false); // removed on success despite no button
	});

	it('on error with no submit button still surfaces the inline error', async () => {
		fetchImpl = () => Promise.reject(new Error('offline'));
		const list = document.createElement('ol');
		list.setAttribute('data-feed-list', '');
		const row = document.createElement('li');
		row.setAttribute('data-feed-row', '');
		const form = document.createElement('form');
		form.setAttribute('data-read-form', '');
		form.action = 'https://news.test/api/read';
		const readField = document.createElement('input');
		readField.type = 'hidden';
		readField.name = 'read';
		readField.value = '1';
		const working = readWorking();
		form.append(readField, working);
		row.append(form);
		list.append(row);
		document.body.append(list);

		// button is null → the `if (button) restoreButton` branch is skipped, but the
		// error is still shown and the row kept.
		dispatchSubmit(form);
		await flush();
		expect(row.isConnected).toBe(true);
		expect(working.getAttribute('role')).toBe('alert');
	});

	it('skips the error line when a failed read form has no "Working…" slot', async () => {
		fetchImpl = () => Promise.reject(new Error('offline'));
		const list = document.createElement('ol');
		list.setAttribute('data-feed-list', '');
		const row = document.createElement('li');
		row.setAttribute('data-feed-row', '');
		const form = document.createElement('form');
		form.setAttribute('data-read-form', '');
		form.action = 'https://news.test/api/read';
		const readField = document.createElement('input');
		readField.type = 'hidden';
		readField.name = 'read';
		readField.value = '1';
		const button = document.createElement('button');
		button.type = 'submit';
		form.append(readField, button);
		row.append(form);
		list.append(row);
		document.body.append(list);

		// No [data-read-working] → showReadError finds nothing, but the square is
		// still restored and nothing throws.
		dispatchSubmit(form, button);
		await flush();
		expect(button.disabled).toBe(false);
		expect(row.isConnected).toBe(true);
	});

	it('clamps a tally at zero rather than rendering a negative count', async () => {
		// A stale DOM where the left tab already reads 0: decrementing must not go
		// to -1. (The joined tab still increments.)
		const { form, button } = readRow('1');
		const tallies = tabTallies(0, 0);

		dispatchSubmit(form, button);
		await flush();

		expect(tallies.unread.textContent).toBe('0'); // max(0, 0 - 1)
		expect(tallies.read.textContent).toBe('1');
	});

	it('treats a non-numeric tally as zero before bumping', async () => {
		const { form, button } = readRow('1');
		const u = document.createElement('span');
		u.setAttribute('data-tab-count', 'unread');
		u.textContent = '—'; // junk, e.g. a not-yet-rendered tally
		const r = document.createElement('span');
		r.setAttribute('data-tab-count', 'read');
		r.textContent = 'x';
		document.body.append(u, r);

		dispatchSubmit(form, button);
		await flush();

		// Unparseable → base 0: read joined (0 → 1), unread left (max(0, 0-1) = 0).
		expect(r.textContent).toBe('1');
		expect(u.textContent).toBe('0');
	});

	it('treats an absent tally textContent as zero', async () => {
		const { form, button } = readRow('1');
		// A tally span whose textContent is null-ish (empty) — exercises the ?? '' path.
		const u = document.createElement('span');
		u.setAttribute('data-tab-count', 'unread');
		const r = document.createElement('span');
		r.setAttribute('data-tab-count', 'read');
		document.body.append(u, r);

		dispatchSubmit(form, button);
		await flush();

		expect(r.textContent).toBe('1'); // 0 + 1
		expect(u.textContent).toBe('0'); // max(0, 0 - 1)
	});
});
