// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit test for the browser-only "visited" indicator (#263). Runs in the node
// project under a per-file happy-dom environment (see the docblock above) so
// `document`, `localStorage`, `MouseEvent`, and click-event delegation resolve —
// the workerd pool can't host a DOM, so this file is excluded there
// (vitest.workers.config.ts) and included here (vitest.node.config.ts).
//
// Importing the module for its side effect registers the single delegated `click`
// listener on `document` plus the astro:page-load / DOMContentLoaded re-apply
// listeners — exactly what runs in the browser. The cases dispatch real bubbling
// click events at that listener (not hand-called functions), which is the behavior
// #155-style delegation guarantees: one document-level listener that survives
// ClientRouter swaps. Hermetic — no network, only the in-memory happy-dom
// localStorage.
import { applyVisitedMarks } from '../src/scripts/visited';

const STORE_KEY = 'visited-urls';
const URL_A = 'https://example.com/a';
const URL_B = 'https://example.com/b';

// Build a feed row mirroring Article.astro's markup the module keys off: a
// <li data-feed-row data-visited-url> whose article link is <a data-visited-link>
// wrapping the headline, plus the hidden agate "Opened" tag.
function feedRow(url: string): HTMLLIElement {
	const li = document.createElement('li');
	li.setAttribute('data-feed-row', '');
	li.setAttribute('data-visited-url', url);
	const a = document.createElement('a');
	a.setAttribute('data-visited-link', '');
	a.href = url;
	const h2 = document.createElement('h2');
	h2.textContent = 'A headline';
	a.append(h2);
	const tag = document.createElement('span');
	tag.setAttribute('data-visited-tag', '');
	li.append(a, tag);
	return li;
}

// Dispatch a real bubbling click on `target` so it reaches the delegated document
// listener — the actual trigger the module enhances.
function click(target: Element): void {
	target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

beforeEach(() => {
	document.body.innerHTML = '';
	localStorage.clear();
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('visited indicator (#263)', () => {
	it('marks a row visited and persists its URL when its article link is opened', () => {
		const row = feedRow(URL_A);
		document.body.append(row);

		// Click the headline inside the link (closest() should walk up to the <a>).
		click(row.querySelector('h2')!);

		// The row is marked immediately (the indicator appears without a reload)…
		expect(row.hasAttribute('data-visited')).toBe(true);
		// …and the URL is persisted so it survives the next render.
		expect(JSON.parse(localStorage.getItem(STORE_KEY)!)).toEqual([URL_A]);
	});

	it('re-applies a persisted mark to a freshly-rendered row (ClientRouter re-render)', () => {
		// A prior session opened URL_A; the store carries it.
		localStorage.setItem(STORE_KEY, JSON.stringify([URL_A]));

		// A new render puts the same row back (e.g. after a ClientRouter <main> swap).
		const rowA = feedRow(URL_A);
		const rowB = feedRow(URL_B);
		document.body.append(rowA, rowB);

		// astro:page-load is the registered re-apply entry point (fires on initial
		// load and after every ClientRouter navigation).
		document.dispatchEvent(new Event('astro:page-load'));

		// Only the stored URL's row is marked; the other stays unmarked.
		expect(rowA.hasAttribute('data-visited')).toBe(true);
		expect(rowB.hasAttribute('data-visited')).toBe(false);
	});

	it('visited state is INDEPENDENT of read state — neither attribute touches the other', () => {
		// A row that is already marked "read" (a stand-in for the read square's
		// dimming/fill state) and gets visited must keep BOTH marks; visiting must not
		// clear read, and the module only ever sets data-visited.
		const row = feedRow(URL_A);
		row.setAttribute('data-read', '');
		document.body.append(row);

		click(row.querySelector('a')!);

		expect(row.hasAttribute('data-visited')).toBe(true);
		// The read marker is untouched by visiting.
		expect(row.hasAttribute('data-read')).toBe(true);

		// And applying visited marks for a DIFFERENT, never-visited read row does not
		// add a visited mark to it (read alone never implies visited).
		const readOnly = feedRow(URL_B);
		readOnly.setAttribute('data-read', '');
		document.body.append(readOnly);
		applyVisitedMarks();
		expect(readOnly.hasAttribute('data-visited')).toBe(false);
	});

	it('accumulates multiple opened URLs in the store', () => {
		const rowA = feedRow(URL_A);
		const rowB = feedRow(URL_B);
		document.body.append(rowA, rowB);

		click(rowA.querySelector('a')!);
		click(rowB.querySelector('a')!);

		expect(rowA.hasAttribute('data-visited')).toBe(true);
		expect(rowB.hasAttribute('data-visited')).toBe(true);
		expect(new Set(JSON.parse(localStorage.getItem(STORE_KEY)!))).toEqual(
			new Set([URL_A, URL_B]),
		);
	});

	it('does not preventDefault — the click still navigates', () => {
		const row = feedRow(URL_A);
		document.body.append(row);
		const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
		row.querySelector('a')!.dispatchEvent(ev);
		// The module records + marks but must never cancel the navigation.
		expect(ev.defaultPrevented).toBe(false);
		expect(row.hasAttribute('data-visited')).toBe(true);
	});

	it('ignores a click outside any article link', () => {
		const row = feedRow(URL_A);
		const outside = document.createElement('button');
		outside.textContent = 'elsewhere';
		document.body.append(row, outside);

		click(outside);

		// Nothing recorded, nothing marked.
		expect(localStorage.getItem(STORE_KEY)).toBeNull();
		expect(row.hasAttribute('data-visited')).toBe(false);
	});

	it('ignores a non-Element click target (e.g. document)', () => {
		// A click whose target isn't an Element must be guarded before closest().
		document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(localStorage.getItem(STORE_KEY)).toBeNull();
	});

	it('ignores a marked link that is not inside a row with a URL', () => {
		// A stray data-visited-link with no enclosing [data-visited-url] row has
		// nothing to record — the row?.dataset.visitedUrl is undefined.
		const a = document.createElement('a');
		a.setAttribute('data-visited-link', '');
		a.href = URL_A;
		a.textContent = 'orphan';
		document.body.append(a);

		click(a);

		expect(localStorage.getItem(STORE_KEY)).toBeNull();
	});

	it('applyVisitedMarks is a no-op when nothing has been opened (empty store)', () => {
		const row = feedRow(URL_A);
		document.body.append(row);
		// No store key at all — the early return path.
		applyVisitedMarks();
		expect(row.hasAttribute('data-visited')).toBe(false);
	});

	it('tolerates a corrupt (non-JSON) store value as empty', () => {
		localStorage.setItem(STORE_KEY, 'not json{');
		const row = feedRow(URL_A);
		document.body.append(row);
		// JSON.parse throws → caught → empty set → no marks, no crash.
		expect(() => applyVisitedMarks()).not.toThrow();
		expect(row.hasAttribute('data-visited')).toBe(false);
	});

	it('tolerates a non-array store value as empty', () => {
		// A JSON value that parses but isn't an array (legacy/corrupt) → empty set.
		localStorage.setItem(STORE_KEY, JSON.stringify({ a: 1 }));
		const row = feedRow(URL_A);
		document.body.append(row);
		applyVisitedMarks();
		expect(row.hasAttribute('data-visited')).toBe(false);
	});

	it('drops non-string entries from a stored array', () => {
		// A poisoned array (a number snuck in) must not mark a row; only the valid
		// string URL is honored.
		localStorage.setItem(STORE_KEY, JSON.stringify([URL_A, 42, null]));
		const rowA = feedRow(URL_A);
		const rowB = feedRow(URL_B);
		document.body.append(rowA, rowB);
		applyVisitedMarks();
		expect(rowA.hasAttribute('data-visited')).toBe(true);
		expect(rowB.hasAttribute('data-visited')).toBe(false);
	});

	it('marks the row even when the store write fails (session-only fallback)', () => {
		// localStorage.setItem throwing (quota/private mode) must not break the click:
		// the in-memory mark still applies, it just won't persist.
		const row = feedRow(URL_A);
		document.body.append(row);
		const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
			throw new Error('quota exceeded');
		});

		expect(() => click(row.querySelector('a')!)).not.toThrow();
		expect(row.hasAttribute('data-visited')).toBe(true);
		expect(setItem).toHaveBeenCalled();
		// happy-dom's localStorage is a Proxy, so vi.restoreAllMocks doesn't reliably
		// undo a spy on the instance method — restore it explicitly so the throwing
		// stub can't leak into a later test.
		setItem.mockRestore();
	});

	it('tolerates a read failure (getItem throwing) as empty', () => {
		// localStorage.getItem throwing (storage disabled) is swallowed: an empty set,
		// no marks, no crash.
		const row = feedRow(URL_A);
		document.body.append(row);
		const getItem = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
			throw new Error('storage disabled');
		});
		expect(() => applyVisitedMarks()).not.toThrow();
		expect(row.hasAttribute('data-visited')).toBe(false);
		expect(getItem).toHaveBeenCalled();
		// See the setItem note above — restore the Proxy-instance spy explicitly.
		getItem.mockRestore();
	});

	it('re-applies on DOMContentLoaded (the no-ClientRouter entry point)', () => {
		localStorage.setItem(STORE_KEY, JSON.stringify([URL_A]));
		const row = feedRow(URL_A);
		document.body.append(row);
		document.dispatchEvent(new Event('DOMContentLoaded'));
		expect(row.hasAttribute('data-visited')).toBe(true);
	});
});
