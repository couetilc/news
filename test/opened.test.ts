// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit test for the mark-read-on-open beacon (#334), the server-side successor
// to the #263 localStorage "Opened" tag. Runs in the node project under a
// per-file happy-dom environment (workerd can't host a DOM — excluded there in
// vitest.workers.config.ts, included in vitest.node.config.ts).
//
// Importing the module for its side effect registers the single delegated
// `click` listener on `document` — exactly what runs in the browser — and each
// case dispatches a real bubbling click at it. The transport seams
// (navigator.sendBeacon / fetch) are stubbed per test, so the suite stays
// hermetic: no request ever leaves the process. The e2e
// (e2e/recently-viewed.spec.ts) covers the real click → POST → lane round-trip.
import '../src/scripts/opened';

const URL_A = 'https://example.com/a';

// Mirror the interactive Article.astro row the module keys off: an <li
// data-feed-row data-item-id> whose article link is <a data-opened-link>
// wrapping the headline.
function feedRow(id: number, url: string = URL_A): HTMLLIElement {
	const li = document.createElement('li');
	li.setAttribute('data-feed-row', '');
	li.setAttribute('data-item-id', String(id));
	const a = document.createElement('a');
	a.setAttribute('data-opened-link', '');
	a.href = url;
	const h2 = document.createElement('h2');
	h2.textContent = 'A headline';
	a.append(h2);
	li.append(a);
	return li;
}

// Dispatch a real bubbling click on `target` so it reaches the delegated
// document listener — the actual trigger the module enhances.
function click(target: Element): void {
	target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

// Read the {id, read} pair back out of the FormData a transport stub captured.
function fields(body: FormData): { id: FormDataEntryValue | null; read: FormDataEntryValue | null } {
	return { id: body.get('id'), read: body.get('read') };
}

// Install a sendBeacon stub (happy-dom's navigator has none by default) and
// return its spy. `queued` is what the browser reports: false = refused (quota),
// which must fall through to the keepalive fetch.
function stubBeacon(queued: boolean) {
	const spy = vi.fn<(url: string, body: FormData) => boolean>(() => queued);
	Object.defineProperty(navigator, 'sendBeacon', { value: spy, configurable: true, writable: true });
	return spy;
}

function unsetBeacon(): void {
	Object.defineProperty(navigator, 'sendBeacon', {
		value: undefined,
		configurable: true,
		writable: true,
	});
}

function stubFetch(impl: () => Promise<Response>) {
	const spy = vi.fn<typeof fetch>(impl as never);
	vi.stubGlobal('fetch', spy);
	return spy;
}

beforeEach(() => {
	document.body.innerHTML = '';
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	unsetBeacon();
});

describe('mark-read-on-open beacon (#334)', () => {
	it('beacons the row id as a read=1 POST to /api/read when the headline is opened', () => {
		const beacon = stubBeacon(true);
		const fetchSpy = stubFetch(() => Promise.resolve(new Response(null)));
		const row = feedRow(42);
		document.body.append(row);

		// Click the headline inside the link (closest() walks up to the <a>).
		click(row.querySelector('h2')!);

		expect(beacon).toHaveBeenCalledTimes(1);
		const [target, body] = beacon.mock.calls[0];
		expect(target).toBe('/api/read');
		// The POST carries the same shape the read square submits: the item id and
		// read=1 — never read=0 (opening can only mark read).
		expect(fields(body)).toEqual({ id: '42', read: '1' });
		// sendBeacon queued it, so the fetch fallback must not fire too (that would
		// double-POST; harmless server-side but wasteful).
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('does not preventDefault — the click still navigates', () => {
		stubBeacon(true);
		const row = feedRow(7);
		document.body.append(row);
		const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
		row.querySelector('a')!.dispatchEvent(ev);
		// The module only records — it must never cancel the navigation.
		expect(ev.defaultPrevented).toBe(false);
	});

	it('falls back to a keepalive fetch when sendBeacon refuses (quota)', () => {
		const beacon = stubBeacon(false);
		const fetchSpy = stubFetch(() => Promise.resolve(new Response(null)));
		const row = feedRow(9);
		document.body.append(row);

		click(row.querySelector('a')!);

		expect(beacon).toHaveBeenCalledTimes(1);
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/read');
		expect(init.method).toBe('POST');
		// keepalive lets the POST survive the navigation tearing the page down.
		expect(init.keepalive).toBe(true);
		expect(fields(init.body as FormData)).toEqual({ id: '9', read: '1' });
	});

	it('falls back to fetch when the browser has no sendBeacon at all', () => {
		unsetBeacon();
		const fetchSpy = stubFetch(() => Promise.resolve(new Response(null)));
		const row = feedRow(3);
		document.body.append(row);

		click(row.querySelector('a')!);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(fields((fetchSpy.mock.calls[0][1] as RequestInit).body as FormData)).toEqual({
			id: '3',
			read: '1',
		});
	});

	it('swallows a rejected fallback fetch (never throws out of the click)', async () => {
		unsetBeacon();
		const fetchSpy = stubFetch(() => Promise.reject(new Error('offline')));
		const row = feedRow(5);
		document.body.append(row);

		expect(() => click(row.querySelector('a')!)).not.toThrow();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		// Let the rejection settle through the .catch — an unhandled rejection here
		// would fail the test run.
		await Promise.resolve();
	});

	it('ignores a click outside any opened-link (e.g. the read square)', () => {
		const beacon = stubBeacon(true);
		const fetchSpy = stubFetch(() => Promise.resolve(new Response(null)));
		const row = feedRow(1);
		const button = document.createElement('button');
		button.textContent = '✓';
		row.append(button);
		document.body.append(row);

		click(button);

		// Nothing sent: only the article link is the open trigger.
		expect(beacon).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('ignores a non-Element click target (e.g. document)', () => {
		const beacon = stubBeacon(true);
		document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(beacon).not.toHaveBeenCalled();
	});

	it('ignores an opened-link outside a row carrying an item id', () => {
		// A public-feed row emits no data-opened-link at all, but a stray hook with
		// no enclosing [data-item-id] must also send nothing — there's no id to post.
		const beacon = stubBeacon(true);
		const fetchSpy = stubFetch(() => Promise.resolve(new Response(null)));
		const a = document.createElement('a');
		a.setAttribute('data-opened-link', '');
		a.href = URL_A;
		a.textContent = 'orphan';
		document.body.append(a);

		click(a);

		expect(beacon).not.toHaveBeenCalled();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it('posts once per opened row, with each row carrying its own id', () => {
		const beacon = stubBeacon(true);
		const rowA = feedRow(11, 'https://example.com/a');
		const rowB = feedRow(22, 'https://example.com/b');
		document.body.append(rowA, rowB);

		click(rowA.querySelector('a')!);
		click(rowB.querySelector('a')!);

		expect(beacon).toHaveBeenCalledTimes(2);
		expect(fields(beacon.mock.calls[0][1])).toEqual({ id: '11', read: '1' });
		expect(fields(beacon.mock.calls[1][1])).toEqual({ id: '22', read: '1' });
	});
});
