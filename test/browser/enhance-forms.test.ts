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
import '../../src/scripts/enhance-forms';

// A controllable fetch stub: each test sets `fetchImpl` to resolve a fake
// Response (ok or not, optionally a followed redirect) or reject (network error).
// Defaults to a successful 303-followed-to-200 that lands back on the feed ('/'),
// the real /api/read shape (fetch follows the redirect, so the toggle sees res.ok
// and a final URL still on the homepage). The body is never read by the module.
type FakeResponse = { ok: boolean; status: number; redirected?: boolean; url?: string };
let fetchImpl: () => Promise<FakeResponse>;
const fetchSpy = vi.fn(() => fetchImpl());

// Spies on the full-page navigation the auth-redirect guard (#250) performs.
const assignSpy = vi.fn();

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
	// The auth-redirect guard (#250) navigates with window.location.assign; happy-dom
	// would otherwise attempt a real navigation. Stub it so the navigation TARGET is
	// observable (and harmless) — the read cases assert what URL the browser was sent to.
	Object.defineProperty(window, 'location', {
		value: { assign: assignSpy },
		writable: true,
		configurable: true,
	});
});

afterEach(() => {
	// Re-assert the stub each test in case anything cleared globals.
	vi.stubGlobal('fetch', fetchSpy);
});

beforeEach(() => {
	document.body.innerHTML = '';
	fetchSpy.mockClear();
	assignSpy.mockClear();
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

// Build a multi-row feed list ending in an infinite-scroll sentinel, the real
// homepage/FeedPage shape when more pages remain (#151): `count` <li data-feed-row>
// rows each wrapping a data-read-form, then a <li data-feed-sentinel data-next-url>
// carrying the positional ?offset cursor for the next /feed page. Returns the list,
// the rows, and the sentinel so a case can toggle a specific row and inspect the
// cursor. Each row's read-form posts the same NEXT state (`read`), and each row id
// is its index so the assertions can name which row was removed.
function readListWithSentinel(
	count: number,
	read: '0' | '1',
	nextUrl: string,
): { list: HTMLElement; rows: HTMLElement[]; sentinel: HTMLElement } {
	const list = document.createElement('ol');
	list.setAttribute('data-feed-list', '');
	list.dataset.emptyMessage = 'All caught up — nothing unread.';

	const rows: HTMLElement[] = [];
	for (let i = 0; i < count; i++) {
		const row = document.createElement('li');
		row.setAttribute('data-feed-row', '');

		const form = document.createElement('form');
		form.setAttribute('data-read-form', '');
		form.action = 'https://news.test/api/read';
		form.method = 'POST';

		const id = document.createElement('input');
		id.type = 'hidden';
		id.name = 'id';
		id.value = String(i);
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
		rows.push(row);
	}

	const sentinel = document.createElement('li');
	sentinel.setAttribute('data-feed-sentinel', '');
	sentinel.dataset.nextUrl = nextUrl;
	sentinel.textContent = 'Loading more…';
	list.append(sentinel);

	document.body.append(list);
	return { list, rows, sentinel };
}

// The read-form and its square inside a given row. The submit event is dispatched
// on the form (the handler ignores a non-form target), with the square as submitter.
function rowControls(row: HTMLElement): { form: HTMLFormElement; button: HTMLButtonElement } {
	const form = row.querySelector<HTMLFormElement>('[data-read-form]');
	const button = row.querySelector<HTMLButtonElement>('button[type="submit"]');
	if (!form || !button) throw new Error('row has no read form / submit button');
	return { form, button };
}

// Toggle a specific row: dispatch the read-form submit with its square as submitter,
// then let the async fetch chain settle.
async function toggleRow(row: HTMLElement): Promise<void> {
	const { form, button } = rowControls(row);
	dispatchSubmit(form, button);
	await flush();
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

	it('removes a feed row that is not inside any feed list (no list cursor/empty-state to touch)', async () => {
		// A [data-feed-row] with no enclosing [data-feed-list] (a defensive shape): on
		// success the row is still removed, but with no list there's no sentinel cursor
		// to re-align and no empty state to render — those steps are simply skipped.
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
		document.body.append(row);

		dispatchSubmit(form, button);
		await flush();

		expect(row.isConnected).toBe(false); // the row is removed
		expect(document.querySelector('[data-feed-empty]')).toBeNull(); // no empty state
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

describe('enhance-forms — read toggle auth-redirect guard (#250)', () => {
	it('treats a followed redirect to /login as auth-expiry: keeps the row, sends the browser to login', async () => {
		// Session lapsed: /api/read 303s to /login, browser fetch follows it, so the
		// response is ok:true but its FINAL url is the login page — NOT a saved toggle.
		fetchImpl = () =>
			Promise.resolve({
				ok: true,
				status: 200,
				redirected: true,
				url: 'https://news.cuteteal.com/login',
			});
		const { row, form, button } = readRow('1');
		const tallies = tabTallies(3, 2);

		dispatchSubmit(form, button);
		await flush();

		// The write never happened: the row must STAY and the tallies must not move.
		expect(row.isConnected).toBe(true);
		expect(tallies.unread.textContent).toBe('3');
		expect(tallies.read.textContent).toBe('2');
		// And the reader is handed the real login flow via a full-page navigation.
		expect(assignSpy).toHaveBeenCalledTimes(1);
		expect(assignSpy).toHaveBeenCalledWith('https://news.cuteteal.com/login');
	});

	it('still removes the row on a redirect that lands back on the feed (a saved toggle)', async () => {
		// The real success shape: /api/read 303s back to the homepage ('/'), fetch
		// follows it, so redirected:true but the final pathname is still the feed —
		// a genuine saved toggle, so the in-place update proceeds and nothing navigates.
		fetchImpl = () =>
			Promise.resolve({
				ok: true,
				status: 200,
				redirected: true,
				url: 'https://news.cuteteal.com/?tab=unread',
			});
		const { row, form, button } = readRow('1');
		tabTallies(3, 2);

		dispatchSubmit(form, button);
		await flush();

		expect(row.isConnected).toBe(false); // removed — the toggle saved
		expect(assignSpy).not.toHaveBeenCalled();
	});
});

describe('enhance-forms — stable pagination after local toggles', () => {
	it('keeps the boundary and filter while invalidating an in-flight page on each removal', async () => {
		const url = '/feed?tab=unread&source=openai&cursor=%5B1000%2C50%5D';
		const {list, rows, sentinel} = readListWithSentinel(2, '1', url);
		tabTallies(120, 0);
		await toggleRow(rows[0]);
		expect(rows[0].isConnected).toBe(false);
		expect(list.dataset.feedRevision).toBe('1');
		await toggleRow(rows[1]);
		expect(list.dataset.feedRevision).toBe('2');
		expect(sentinel.dataset.nextUrl).toBe(url);
		expect(list.isConnected).toBe(true);
		expect(list.querySelector('[data-feed-row]')).toBeNull();
		expect(document.querySelector('[data-feed-empty]')).toBeNull();
	});
});

describe('enhance-forms — retry resets the status slot to loading (#251)', () => {
	it('clears a prior error back to "Working…" (no alert role / accent) on the next submit', async () => {
		// First submit fails: the status slot becomes the inline error.
		fetchImpl = () => Promise.reject(new Error('offline'));
		const { row, form, button, working } = readRow('1');
		tabTallies(3, 2);

		dispatchSubmit(form, button);
		await flush();

		// Error rendered, button restored so the reader can retry.
		expect(row.isConnected).toBe(true);
		expect(button.disabled).toBe(false);
		expect(working.getAttribute('role')).toBe('alert');
		expect(working.classList.contains('text-accent')).toBe(true);
		expect(working.textContent).toBe('Couldn’t save — try again.');

		// Second submit, with the fetch still PENDING (never resolves) so we can inspect
		// the in-flight status slot: the stale error must be gone, replaced by "Working…".
		fetchImpl = () => new Promise<FakeResponse>(() => {});
		dispatchSubmit(form, button);

		// Synchronously (before the fetch settles) the slot is back to the loading state.
		expect(working.hidden).toBe(false);
		expect(working.getAttribute('role')).toBeNull();
		expect(working.classList.contains('text-accent')).toBe(false);
		expect(working.textContent).toBe('Working…');
		// And the square is busy again for the pending save.
		expect(button.disabled).toBe(true);
		expect(button.getAttribute('aria-busy')).toBe('true');
	});
});

// Recently viewed is global; its rows are not members of the active unread
// query until their source matches AND the toggle has saved successfully.
describe('Recently viewed reconciliation (#381)', () => {
	function recent(active: boolean, sortTime = 20, id = 7) {
		const controls = readRow('0');
		controls.row.insertAdjacentHTML('afterbegin', '<h2>Recent headline</h2>');
		controls.row.dataset.activeFeed = String(active);
		controls.row.dataset.sortTime = String(sortTime);
		controls.row.dataset.itemId = String(id);
		controls.row.dataset.readState = 'read';
		controls.button.setAttribute('aria-label', 'Mark as unread');
		const lane = document.createElement('section');
		lane.setAttribute('data-recently-viewed', '');
		lane.innerHTML = '<span data-recent-count>1</span><ol></ol>';
		lane.querySelector('ol')!.append(controls.row);
		controls.list.replaceWith(lane);
		return {...controls, lane};
	}
	function main(times: number[], sentinel = false) {
		const {list, rows, sentinel: cursor} = readListWithSentinel(times.length, '1', `/feed?tab=unread&source=openai&cursor=${encodeURIComponent(JSON.stringify([times.at(-1), times.length]))}`);
		rows.forEach((row, i) => { row.dataset.sortTime = String(times[i]); row.dataset.itemId = String(i + 1); });
		if (!sentinel) cursor.remove();
		return {list, rows, cursor};
	}
	it('does not retally an unrelated source, and removes the last history section', async () => {
		const {row, lane} = recent(false);
		const {list} = main([30, 10], true);
		const counts = tabTallies(2, 0);
		await toggleRow(row);
		expect(lane.isConnected).toBe(false);
		expect(list.querySelectorAll('[data-feed-row]')).toHaveLength(2);
		expect(counts.unread.textContent).toBe('2');
		expect(counts.read.textContent).toBe('0');
		expect(list.querySelector<HTMLElement>('[data-feed-sentinel]')!.dataset.nextUrl).toContain('cursor=%5B10%2C2%5D');
	});
	it('returns a matching row in chronological order and updates its complete control state', async () => {
		const {row, form, button, working, lane} = recent(true);
		const {list, rows, cursor} = main([30, 10], true);
		const counts = tabTallies(2, 1);
		await toggleRow(row);
		expect([...list.querySelectorAll('[data-feed-row]')]).toEqual([rows[0], row, rows[1]]);
		expect(row.dataset.readState).toBe('unread');
		expect(form.querySelector<HTMLInputElement>('[name="read"]')!.value).toBe('1');
		expect(button.getAttribute('aria-label')).toBe('Mark as read');
		expect(button.disabled).toBe(false);
		expect(button.hasAttribute('aria-busy')).toBe(false);
		expect(working.hidden).toBe(true);
		expect(working.getAttribute('aria-hidden')).toBe('true');
		expect(counts.unread.textContent).toBe('3');
		expect(counts.read.textContent).toBe('0');
		expect(cursor.dataset.nextUrl).toBe('/feed?tab=unread&source=openai&cursor=%5B10%2C2%5D');
		expect(lane.isConnected).toBe(false);
	});
	it('uses descending item ids to break timestamp ties and keeps the remaining lane count', async () => {
		const {row, lane} = recent(true, 30, 7);
		const other = document.createElement('li'); other.setAttribute('data-feed-row', '');
		lane.querySelector('ol')!.append(other);
		const {list, rows} = main([30]);
		await toggleRow(row);
		expect([...list.querySelectorAll('[data-feed-row]')]).toEqual([row, rows[0]]);
		expect(lane.querySelector('[data-recent-count]')!.textContent).toBe('1');
		expect(lane.querySelectorAll('[data-feed-row]')).toHaveLength(1);
	});
	it('appends older items once the unread list is fully loaded', async () => {
		const {row} = recent(true, 20, 0);
		const {list, rows} = main([20]);
		await toggleRow(row);
		expect([...list.querySelectorAll('[data-feed-row]')]).toEqual([...rows, row]);
	});
	it('leaves an older returned item for its future page without moving the loaded cursor', async () => {
		const {row} = recent(true, 5);
		const {list, rows, cursor} = main([30, 10], true);
		const counts=tabTallies(10, 1);
		await toggleRow(row);
		expect([...list.querySelectorAll('[data-feed-row]')]).toEqual(rows);
		expect(cursor.dataset.nextUrl).toBe('/feed?tab=unread&source=openai&cursor=%5B10%2C2%5D');
		expect(counts.unread.textContent).toBe('11');
	});
	it('replaces the caught-up message with a working list and retains its empty copy', async () => {
		const {row} = recent(true);
		const empty = document.createElement('p'); empty.setAttribute('data-feed-empty', '');
		empty.textContent = 'All caught up for these sources.'; document.body.append(empty);
		await toggleRow(row);
		expect(empty.isConnected).toBe(false);
		const list = document.querySelector<HTMLElement>('[data-feed-list]')!;
		expect(list.dataset.emptyMessage).toBe('All caught up for these sources.');
		expect(list.querySelector('[data-feed-row]')).toBe(row);
		await toggleRow(row);
		expect(list.dataset.emptyMessage).toBe('All caught up for these sources.');
		expect(list.querySelector('[data-read-receipt]')!.textContent).toContain('Undo');
		expect(list.querySelector('[data-feed-row]')).toBeNull();
	});
	it('ignores a completed write from a form replaced by tab/filter navigation', async () => {
		const {row} = recent(true);
		let done!: (response: FakeResponse) => void;
		fetchImpl = () => new Promise((resolve) => { done = resolve; });
		const {form, button} = rowControls(row); dispatchSubmit(form, button);
		document.body.innerHTML = '';
		const {list} = main([30, 10]); const counts=tabTallies(2,0);
		done({ok:true,status:200}); await flush();
		expect(list.querySelectorAll('[data-feed-row]')).toHaveLength(2);
		expect(counts.unread.textContent).toBe('2');
		expect(counts.read.textContent).toBe('0');
	});
	it('keeps both regions and counts unchanged on failure, then allows retry', async () => {
		const {row, lane, button} = recent(true);
		const {list} = main([30, 10]); const counts=tabTallies(2,1);
		fetchImpl=()=>Promise.reject(new Error('offline'));
		await toggleRow(row);
		expect(row.closest('[data-recently-viewed]')).toBe(lane);
		expect(list.querySelectorAll('[data-feed-row]')).toHaveLength(2);
		expect(counts.unread.textContent).toBe('2');
		expect(button.disabled).toBe(false);
		expect(lane.querySelector('[role="alert"]')!.textContent).toBe('Couldn’t save — try again.');
		fetchImpl=()=>Promise.resolve({ok:true,status:200}); await toggleRow(row);
		expect(list.querySelectorAll('[data-feed-row]')).toHaveLength(3);
		expect(lane.isConnected).toBe(false);
	});
});

it('returns a row above the served boundary even when every previously loaded row was removed', async () => {
	const {list, rows, sentinel} = readListWithSentinel(1, '1', '/feed?tab=unread&cursor=%5B10%2C2%5D');
	rows[0].remove();
	const {row, form, button} = readRow('0');
	row.dataset.sortTime = '10'; row.dataset.itemId = '2';
	const lane = document.createElement('section'); lane.setAttribute('data-recently-viewed', ''); lane.append(row); document.body.append(lane);
	dispatchSubmit(form, button); await flush();
	expect(Array.from(list.children)).toEqual([row, sentinel]);
	expect(list.dataset.feedRevision).toBe('1');
});

function swipeRow() {
 const entry = readRow('1');
 entry.row.dataset.swipeRead = '';
 entry.row.insertAdjacentHTML('afterbegin','<h2>Test headline</h2>');
 return entry;
}
const flushRead = async () => { await new Promise((resolve) => setTimeout(resolve,0)); };
const undoForm = () => document.querySelector<HTMLFormElement>('[data-read-undo]')!;

it('offers inline Undo, restores the exact row and counts, and keeps activity and cursor fixed', async () => {
 const {row,form,button,list,working} = swipeRow();
 list.insertAdjacentHTML('beforeend','<li data-feed-sentinel data-next-url="/feed?cursor=1000:2"></li>');
 document.body.insertAdjacentHTML('afterbegin','<span data-tab-count="unread">2</span><span data-tab-count="read">0</span><section data-activity-briefing>3 posts</section>');
 button.focus();dispatchSubmit(form);dispatchSubmit(form);await flushRead();
 expect(fetchSpy).toHaveBeenCalledOnce();expect(row.isConnected).toBe(false);expect(list.isConnected).toBe(true);
 const undo=undoForm();expect(undo.textContent).toContain('Undo');expect(undo.querySelector('button')!.getAttribute('aria-label')).toContain('Test headline');
 expect(document.activeElement).toBe(undo.querySelector('button'));expect(list.querySelector('[data-feed-sentinel]')!.getAttribute('data-next-url')).toBe('/feed?cursor=1000:2');
 expect(document.querySelector('[data-tab-count="unread"]')!.textContent).toBe('1');
 dispatchSubmit(undo);await flushRead();
 expect(list.firstElementChild).toBe(row);expect(button.disabled).toBe(false);expect(working.hidden).toBe(true);expect(document.activeElement).toBe(button);
 expect(undo.isConnected).toBe(false);expect(document.querySelector('[data-tab-count="unread"]')!.textContent).toBe('2');expect(list.dataset.feedRevision).toBe('2');
 expect(document.querySelector('[data-activity-briefing]')!.textContent).toBe('3 posts');
});
it('keeps a last-row receipt, recovers an Undo failure inline and allows retry without stealing focus', async () => {
 const {row,form,list} = swipeRow();dispatchSubmit(form);await flushRead();
 expect(list.isConnected).toBe(true);expect(document.querySelector('[data-feed-empty]')!.textContent).toContain('All caught up');
 const undo=undoForm();fetchImpl=()=>Promise.reject(new Error('offline'));dispatchSubmit(undo);await flushRead();
 expect(undo.querySelector('[role="alert"]')!.textContent).toContain('Couldn’t save');expect(undo.querySelector('button')!.disabled).toBe(false);expect(row.isConnected).toBe(false);
 fetchImpl=()=>Promise.resolve({ok:true,status:200});dispatchSubmit(undo);await flushRead();expect(row.isConnected).toBe(true);
});
it('replaces the previous completed receipt but retains an Undo that is still saving', async () => {
 const a=swipeRow();const b=swipeRow();a.list.append(b.row);b.list.remove();
 dispatchSubmit(a.form);await flushRead();const first=undoForm();
 let resolve!: (r:FakeResponse)=>void; fetchImpl=()=>new Promise(r=>{resolve=r;});dispatchSubmit(first);
 fetchImpl=()=>Promise.resolve({ok:true,status:200});dispatchSubmit(b.form);await flushRead();
 expect(document.querySelectorAll('[data-read-receipt]')).toHaveLength(2);
 resolve({ok:true,status:200});await flushRead();expect(a.row.isConnected).toBe(true);
 dispatchSubmit(a.form);await flushRead();expect(document.querySelectorAll('[data-read-receipt]')).toHaveLength(1);
});

it('recovers browser-blurred keyboard focus without stealing a deliberate move elsewhere', async () => {
 const {form,button} = swipeRow();button.focus();
 let done!: (r:FakeResponse)=>void;fetchImpl=()=>new Promise(r=>{done=r;});dispatchSubmit(form);button.blur();
 done({ok:true,status:200});await flushRead();const undo=undoForm();expect(document.activeElement).toBe(undo.querySelector('button'));
 fetchImpl=()=>Promise.reject(new Error('offline'));dispatchSubmit(undo);(undo.querySelector('button')!).blur();await flushRead();expect(document.activeElement).toBe(undo.querySelector('button'));
 fetchImpl=()=>new Promise(r=>{done=r;});dispatchSubmit(undo);const other=document.createElement('button');document.body.append(other);other.focus();done({ok:true,status:200});await flushRead();expect(document.activeElement).toBe(other);
});
