// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unit test for the browser-only infinite-scroll loader (#151). Runs in the node
// project under a per-file happy-dom environment so document/IntersectionObserver
// (faked below)/fetch resolve — the workerd pool can't host a DOM, so this file
// is excluded there and included in vitest.node.config.ts.
//
// happy-dom has no IntersectionObserver, so we install a controllable fake on the
// global before importing the module. The fake records what it observes and lets
// a test fire an "intersection" on demand, which is exactly the scroll trigger
// the real observer fires — so the cases exercise the registered observer
// callback, the fetch, the fragment parse/append, and the sentinel replacement.

// One fake observer instance: it captures the callback the module passes and the
// elements it observes, and exposes trigger()/observed() for the test to drive.
class FakeIntersectionObserver {
	static instances: FakeIntersectionObserver[] = [];
	callback: IntersectionObserverCallback;
	elements: Element[] = [];
	unobserved: Element[] = [];

	constructor(callback: IntersectionObserverCallback) {
		this.callback = callback;
		FakeIntersectionObserver.instances.push(this);
	}
	observe(el: Element): void {
		this.elements.push(el);
	}
	unobserve(el: Element): void {
		this.unobserved.push(el);
	}
	disconnect(): void {}

	// Fire an intersection for `el` as if it scrolled into view.
	trigger(el: Element, isIntersecting = true): void {
		this.callback(
			[{ target: el, isIntersecting } as unknown as IntersectionObserverEntry],
			this as unknown as IntersectionObserver,
		);
	}
}

vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);

// initInfiniteScroll is exported for direct invocation; importing also registers
// the astro:page-load / DOMContentLoaded listeners (covered via dispatch below).
import { initInfiniteScroll } from '../src/scripts/infinite-scroll';

// Build the homepage's initial list: an <ol data-feed-list> with one article row
// and a trailing sentinel pointing at the next page.
function listWithSentinel(nextUrl = '/feed?tab=unread&offset=50'): HTMLOListElement {
	const ol = document.createElement('ol');
	ol.setAttribute('data-feed-list', '');
	const article = document.createElement('li');
	article.textContent = 'Item 1';
	const sentinel = document.createElement('li');
	sentinel.setAttribute('data-feed-sentinel', '');
	sentinel.setAttribute('data-next-url', nextUrl);
	sentinel.textContent = 'Loading more…';
	ol.append(article, sentinel);
	return ol;
}

// A /feed fragment: new rows + (optionally) a fresh sentinel for the page after.
function fragment(opts: { ids: number[]; nextUrl?: string }): string {
	const rows = opts.ids.map((id) => `<li>Item ${id}</li>`).join('');
	const sentinel =
		opts.nextUrl === undefined
			? ''
			: `<li data-feed-sentinel data-next-url="${opts.nextUrl}">Loading more…</li>`;
	return rows + sentinel;
}

const okText = (body: string): Response => ({ ok: true, text: async () => body }) as Response;

// A 200 response whose final URL differs from the requested /feed — what browser
// fetch returns after transparently following the auth middleware's 303 to
// /login when the session has lapsed (#216). `redirected` is true and `url` is
// the post-redirect URL; the body, if read, would be the login page HTML.
const redirectedTo = (finalUrl: string, body = '<form>login</form>'): Response =>
	({ ok: true, redirected: true, url: finalUrl, text: async () => body }) as Response;

beforeEach(() => {
	document.body.innerHTML = '';
	FakeIntersectionObserver.instances = [];
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('infinite-scroll loader (#151)', () => {
	it('is a no-op when there is no feed list (anonymous feed / login)', () => {
		// No [data-feed-list] on the page: nothing observed, no crash.
		initInfiniteScroll();
		expect(FakeIntersectionObserver.instances).toHaveLength(0);
	});

	it('observes the initial sentinel', () => {
		document.body.append(listWithSentinel());
		initInfiniteScroll();
		const obs = FakeIntersectionObserver.instances.at(-1)!;
		expect(obs.elements).toHaveLength(1);
		expect((obs.elements[0] as HTMLElement).dataset.feedSentinel).toBe('');
	});

	it('appends the fetched page before the sentinel and observes the fresh sentinel', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValue(okText(fragment({ ids: [2, 3], nextUrl: '/feed?tab=unread&offset=100' })));
		vi.stubGlobal('fetch', fetchMock);

		document.body.append(listWithSentinel());
		initInfiniteScroll();
		const obs = FakeIntersectionObserver.instances.at(-1)!;
		const sentinel = obs.elements[0];

		obs.trigger(sentinel);
		await vi.waitFor(() => {
			expect(document.body.textContent).toContain('Item 3');
		});

		// The fetch used the sentinel's next-url.
		expect(fetchMock).toHaveBeenCalledWith('/feed?tab=unread&offset=50');
		// New rows landed BEFORE where the sentinel was (after the original Item 1).
		const list = document.querySelector('[data-feed-list]')!;
		const texts = [...list.children].map((c) => c.textContent?.trim());
		expect(texts.slice(0, 3)).toEqual(['Item 1', 'Item 2', 'Item 3']);
		// The old sentinel was unobserved and removed; the fresh one is now observed.
		expect(obs.unobserved).toContain(sentinel);
		expect(list.contains(sentinel)).toBe(false);
		const freshSentinel = list.querySelector('[data-feed-sentinel]')!;
		expect(freshSentinel.getAttribute('data-next-url')).toBe('/feed?tab=unread&offset=100');
		expect(obs.elements).toContain(freshSentinel);
	});

	it('stops at the last page: the exhausting fragment has no sentinel, so no further fetch', async () => {
		const fetchMock = vi.fn().mockResolvedValue(okText(fragment({ ids: [2, 3] }))); // no nextUrl
		vi.stubGlobal('fetch', fetchMock);

		document.body.append(listWithSentinel());
		initInfiniteScroll();
		const obs = FakeIntersectionObserver.instances.at(-1)!;
		obs.trigger(obs.elements[0]);
		await vi.waitFor(() => expect(document.body.textContent).toContain('Item 3'));

		// No sentinel remains, so there is nothing left to observe or fetch.
		expect(document.querySelector('[data-feed-sentinel]')).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('ignores a non-intersecting entry and re-entrant intersections while one is in flight', async () => {
		let resolve!: (r: Response) => void;
		const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r)));
		vi.stubGlobal('fetch', fetchMock);

		document.body.append(listWithSentinel());
		initInfiniteScroll();
		const obs = FakeIntersectionObserver.instances.at(-1)!;
		const sentinel = obs.elements[0];

		// A non-intersecting callback does nothing.
		obs.trigger(sentinel, false);
		expect(fetchMock).not.toHaveBeenCalled();

		// First real intersection starts the fetch; a second (scroll jitter) before
		// it resolves is ignored — still exactly one fetch.
		obs.trigger(sentinel);
		obs.trigger(sentinel);
		expect(fetchMock).toHaveBeenCalledTimes(1);

		// Let it resolve so the test ends cleanly.
		resolve(okText(fragment({ ids: [2] })));
		await vi.waitFor(() => expect(document.body.textContent).toContain('Item 2'));
	});

	it('surfaces a fetch error in voice and keeps the sentinel so a later scroll retries', async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
		vi.stubGlobal('fetch', fetchMock);

		document.body.append(listWithSentinel());
		initInfiniteScroll();
		const obs = FakeIntersectionObserver.instances.at(-1)!;
		const sentinel = obs.elements[0] as HTMLElement;

		obs.trigger(sentinel);
		await vi.waitFor(() => {
			expect(sentinel.textContent).toContain('Couldn’t load more');
		});
		// The sentinel stays in the list (not removed), so a later intersection can
		// retry: triggering again fires a second fetch.
		const list = document.querySelector('[data-feed-list]')!;
		expect(list.contains(sentinel)).toBe(true);
		obs.trigger(sentinel);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does nothing for a sentinel with no next-url (defensive)', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		// A sentinel element with no data-next-url is never observed by
		// observeSentinels (its selector requires [data-next-url]); but if one is
		// triggered directly, loadNext early-returns without fetching.
		const ol = document.createElement('ol');
		ol.setAttribute('data-feed-list', '');
		const sentinel = document.createElement('li');
		sentinel.setAttribute('data-feed-sentinel', '');
		ol.append(sentinel);
		document.body.append(ol);

		initInfiniteScroll();
		const obs = FakeIntersectionObserver.instances.at(-1)!;
		// Nothing was observed (no [data-next-url]).
		expect(obs.elements).toHaveLength(0);
		// Triggering it directly still does not fetch.
		obs.trigger(sentinel);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('tolerates a sentinel detached mid-fetch (parent gone) without throwing', async () => {
		// A ClientRouter swap could remove the list while a page is in flight. The
		// loader guards the parent so the append/remove is skipped rather than
		// throwing on a null parentNode.
		let resolve!: (r: Response) => void;
		const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve = r)));
		vi.stubGlobal('fetch', fetchMock);

		const ol = listWithSentinel();
		document.body.append(ol);
		initInfiniteScroll();
		const obs = FakeIntersectionObserver.instances.at(-1)!;
		const sentinel = obs.elements[0] as HTMLElement;

		obs.trigger(sentinel);
		// Detach the sentinel from its list before the fetch resolves.
		sentinel.remove();
		resolve(okText(fragment({ ids: [2], nextUrl: '/feed?tab=unread&offset=100' })));

		// The append is skipped (no parent), no throw, and nothing is observed anew.
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		expect(document.body.textContent).not.toContain('Item 2');
	});

	it('navigates to the login flow instead of appending an auth-redirect response (#216)', async () => {
		// Session lapsed: fetch follows the middleware's 303 and resolves a 200 whose
		// final URL is /login carrying the login page HTML. The loader must NOT parse
		// it as a feed fragment — it should send the browser to that final URL.
		const fetchMock = vi
			.fn()
			.mockResolvedValue(redirectedTo('https://news.cuteteal.com/login'));
		vi.stubGlobal('fetch', fetchMock);
		const assign = vi.fn();
		vi.spyOn(window.location, 'assign').mockImplementation(assign);

		document.body.append(listWithSentinel());
		initInfiniteScroll();
		const obs = FakeIntersectionObserver.instances.at(-1)!;
		const sentinel = obs.elements[0] as HTMLElement;

		obs.trigger(sentinel);
		await vi.waitFor(() => expect(assign).toHaveBeenCalledWith('https://news.cuteteal.com/login'));

		// The login page HTML was never appended: the feed list is untouched (still
		// just the original Item 1 + its sentinel), no <form> leaked in.
		const list = document.querySelector('[data-feed-list]')!;
		expect(list.textContent).not.toContain('login');
		expect(list.contains(sentinel)).toBe(true);
		const texts = [...list.children].map((c) => c.textContent?.trim());
		expect(texts).toEqual(['Item 1', 'Loading more…']);
	});

	it('still appends a redirect that lands back on /feed (e.g. trailing-slash normalization)', async () => {
		// A redirect whose final URL is still /feed (not an auth bounce) is a genuine
		// fragment — parse and append it as usual rather than navigating away.
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			redirected: true,
			url: 'https://news.cuteteal.com/feed?tab=unread&offset=50',
			text: async () => fragment({ ids: [2, 3] }),
		} as Response);
		vi.stubGlobal('fetch', fetchMock);
		const assign = vi.fn();
		vi.spyOn(window.location, 'assign').mockImplementation(assign);

		document.body.append(listWithSentinel());
		initInfiniteScroll();
		const obs = FakeIntersectionObserver.instances.at(-1)!;

		obs.trigger(obs.elements[0]);
		await vi.waitFor(() => expect(document.body.textContent).toContain('Item 3'));

		// No navigation; the rows were appended as a normal fragment.
		expect(assign).not.toHaveBeenCalled();
		const list = document.querySelector('[data-feed-list]')!;
		const texts = [...list.children].map((c) => c.textContent?.trim());
		expect(texts.slice(0, 3)).toEqual(['Item 1', 'Item 2', 'Item 3']);
	});

	it('re-initializes on astro:page-load (ClientRouter swap) without double-observing', () => {
		document.body.append(listWithSentinel());
		// Fire the registered listener (the initial-load / post-swap entry point).
		document.dispatchEvent(new Event('astro:page-load'));
		const obs = FakeIntersectionObserver.instances.at(-1)!;
		expect(obs.elements).toHaveLength(1);

		// A second page-load with the SAME sentinel must not observe it twice (the
		// `observed` WeakSet guard). A new observer is created but observes nothing
		// new.
		document.dispatchEvent(new Event('astro:page-load'));
		const obs2 = FakeIntersectionObserver.instances.at(-1)!;
		expect(obs2.elements).toHaveLength(0);
	});
});
