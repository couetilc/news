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
async function loadNext(sentinel: HTMLElement, observer: IntersectionObserver): Promise<void> {
	const url = sentinel.dataset.nextUrl;
	// A sentinel with no next-url is the end of the list — nothing to load.
	if (url === undefined || loading.has(sentinel)) return;
	loading.add(sentinel);

	try {
		const res = await fetch(url);
		if (!res.ok) throw new Error(`feed page ${res.status}`);
		const html = await res.text();
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
