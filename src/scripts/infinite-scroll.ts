// Infinite-scroll loader for the authenticated feed (#151). The homepage renders
// the first 50 items of the active tab server-side inside <ol data-feed-list>,
// ending in a sentinel <li data-feed-sentinel data-next-url="/feed?…&offset=50">.
// This script watches that sentinel with an IntersectionObserver; when it scrolls
// into view it fetches the next 50-item HTML fragment from /feed, inserts the new
// rows before the sentinel, and replaces the sentinel with the fresh one the
// fragment carries — or, when the list is exhausted, the fragment has no sentinel,
// so scrolling to the bottom is a clean end-of-list with no further fetch (#151,
// "no phantom empty fetch"). The active ?tab and ?source filter ride in the
// sentinel's data-next-url, so every appended page stays in the same tab and
// under the same filter (#41).
//
// Progressive enhancement: with JS off the sentinel is just an inert "Loading
// more…" line and the reader sees the first 50 — there's no no-JS pager fallback,
// a deliberate #151 decision (infinite scroll is inherently JS-driven; the first
// page is always server-rendered so the feed is never blank without JS). The tab
// switch and the read/unread toggle stay plain links/forms that work without JS.
//
// ClientRouter-safe (#155): Astro's <ClientRouter /> swaps <main> on a tab switch
// or any in-app navigation, replacing the list and its observer target, so this
// re-initializes on every astro:page-load (and the initial DOMContentLoaded). A
// module-scope WeakSet tracks already-observed sentinels so a re-init never
// double-observes a surviving one.
//
// Pure DOM logic (no Astro/runtime imports), so it's unit-tested in the node
// project under a per-file happy-dom environment (test/infinite-scroll.test.ts)
// inside the 100% src/** gate, and covered as a real-browser behavioral guard by
// the Playwright e2e (e2e/infinite-scroll.spec.ts).

// Sentinels already handed to the observer, so re-init after a ClientRouter swap
// doesn't observe the same node twice. A WeakSet so a removed sentinel is GC'd.
const observed = new WeakSet<Element>();

// In-flight guard: a sentinel can intersect repeatedly (scroll jitter) before its
// fetch resolves; this marks the one currently loading so a second intersection
// is ignored until the fragment lands and the sentinel is replaced.
const loading = new WeakSet<Element>();

// Parse a returned /feed HTML fragment into its top-level nodes (Article <li>
// rows + an optional trailing sentinel <li>). A <template> parses an <li>
// fragment without the <tr>/<li> auto-insertion quirks a raw div would hit.
function parseFragment(html: string): Node[] {
	const tpl = document.createElement('template');
	tpl.innerHTML = html;
	return Array.from(tpl.content.childNodes);
}

// Fetch and append the next page for one sentinel. Inserts the fetched rows
// before the sentinel, then removes it; the fetched fragment carries its own
// fresh sentinel (observed on the next tick) when more pages remain, or none when
// the list is exhausted. A network error leaves the sentinel in place (its
// in-flight flag cleared) so a later intersection can retry, and is surfaced in
// voice on the sentinel rather than failing silently (#96).
//
// If the session expires while the feed is open, the auth middleware answers a
// /feed fetch with a 303 to /login; browser fetch transparently follows it, so
// res.ok is true and res.text() is the *login page* HTML, not a feed fragment
// (#216). Parsing/appending that would inject the whole login page into the feed
// <ol>. So before treating the response as a fragment, detect that the fetch was
// redirected away from /feed and instead send the browser to the final URL with a
// full-page navigation — handing the reader the real login flow rather than a
// corrupted feed.
//
// In-flight cursor race (#260): the read/unread toggle's in-place removal
// decrements THIS sentinel's data-next-url offset (enhance-forms.ts
// decrementSentinelOffset, #249) so a row that slides into the next page's first
// position isn't skipped. But a decrement can land while a page fetch is already
// in flight, captured against the OLD offset (e.g. offset=50). Appending that
// stale page starts one row too late and skips the row that slid into offset=49.
// So after each fetch resolves, re-read the sentinel's CURRENT data-next-url: if a
// toggle moved it, the fetched page is stale — discard it and re-fetch from the
// adjusted cursor (loop). The cursor only ever decrements toward a stable value,
// so the loop terminates once a fetch resolves against an unchanged data-next-url.
// The loading guard stays held across every re-fetch so a second intersection
// can't start a parallel load.
async function loadNext(sentinel: HTMLElement, observer: IntersectionObserver): Promise<void> {
	// A sentinel with no next-url is the end of the list — nothing to load.
	if (sentinel.dataset.nextUrl === undefined || loading.has(sentinel)) return;
	loading.add(sentinel);

	try {
		// Re-fetch until the page we resolved still matches the sentinel's cursor: a
		// read toggle decrementing data-next-url mid-flight (#260) invalidates the
		// in-flight page, so fetch again from the adjusted offset rather than
		// appending a stale page that starts one row too late. The cursor is defined
		// here (guarded on entry) and the toggle only ever rewrites it, never deletes
		// it, so the non-null assertion documents that invariant without an
		// unreachable undefined-branch the 100% gate would flag.
		for (;;) {
			const url: string = sentinel.dataset.nextUrl!;
			const res = await fetch(url);
			if (!res.ok) throw new Error(`feed page ${res.status}`);
			// An auth-redirect (session lapsed → 303 to /login, followed by fetch) lands
			// here as a 200 whose final URL is no longer /feed. Don't parse it as a
			// fragment — navigate the browser to that final URL so the reader gets the
			// login flow (#216). A full navigation, not an append.
			if (res.redirected && new URL(res.url).pathname !== '/feed') {
				window.location.assign(res.url);
				return;
			}
			const html = await res.text();
			// A read toggle decremented the cursor while this page was in flight (#260):
			// the page we hold is stale (starts one row too late). Discard it and loop to
			// re-fetch from the now-current offset. The cursor only decrements toward a
			// stable value, so this converges once a fetch resolves against an unchanged
			// data-next-url.
			if (sentinel.dataset.nextUrl !== url) continue;
			const nodes = parseFragment(html);
			const parent = sentinel.parentNode;
			// The list is always still mounted here (the same <ol> the sentinel lives
			// in), but guard the parent for the type and so a mid-navigation swap can't
			// throw.
			if (parent) {
				for (const node of nodes) parent.insertBefore(node, sentinel);
				observer.unobserve(sentinel);
				sentinel.remove();
				// Observe the fresh sentinel the fragment brought (if any); none means
				// the list is exhausted, so scrolling further fires no fetch.
				observeSentinels(parent as Element, observer);
			}
			return;
		}
	} catch {
		// Network/server error: keep the sentinel so a later scroll retries, and say
		// so in voice instead of swallowing it (#96, design-system "Surface errors").
		sentinel.textContent = 'Couldn’t load more — scroll to retry.';
		loading.delete(sentinel);
	}
}

// Observe every not-yet-observed sentinel inside `root`. Called on init and after
// each append, so a freshly-inserted sentinel starts being watched.
function observeSentinels(root: ParentNode, observer: IntersectionObserver): void {
	const sentinels = root.querySelectorAll<HTMLElement>('[data-feed-sentinel][data-next-url]');
	for (const sentinel of sentinels) {
		if (!observed.has(sentinel)) {
			observed.add(sentinel);
			observer.observe(sentinel);
		}
	}
}

// Initialize (or re-initialize after a ClientRouter swap) infinite scroll for the
// current document. No-op when there's no feed list on the page (the anonymous
// public feed, /login, etc.), so it's safe to run on every navigation.
export function initInfiniteScroll(): void {
	const list = document.querySelector('[data-feed-list]');
	if (!list) return;

	const observer = new IntersectionObserver((entries) => {
		for (const entry of entries) {
			if (entry.isIntersecting) {
				void loadNext(entry.target as HTMLElement, observer);
			}
		}
	});
	observeSentinels(list, observer);
}

// Run on first load and after every ClientRouter navigation. astro:page-load
// fires on the initial page too, but DOMContentLoaded covers the no-ClientRouter
// case; both are idempotent thanks to the `observed` WeakSet.
document.addEventListener('astro:page-load', initInfiniteScroll);
document.addEventListener('DOMContentLoaded', initInfiniteScroll);
