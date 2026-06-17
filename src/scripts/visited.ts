// "Visited" indicator for feed rows (#263): a persistent, per-device mark on an
// item once its article link has been opened — DISTINCT from and INDEPENDENT of
// the read/unread state (the square toggle). An item can be visited-but-unread,
// read-but-not-visited, etc.; this module never touches the read square and the
// read toggle never touches this mark.
//
// Approach (chosen in #263 over server-side D1): native CSS `:visited` is the
// no-JS baseline (the headline link de-emphasizes once its href is in browser
// history — see the `a:visited` rule in global.css), and THIS module layers a
// richer, reliable indicator on top with localStorage. Native `:visited` is
// privacy-restricted (it can only recolor, never add the agate "Opened" tag) and
// reflects ANY prior visit to the URL; the localStorage layer records exactly the
// links opened FROM the feed and drives the explicit [data-visited] marker. Both
// are per-device (no account sync) — an accepted #263 tradeoff vs. the heavier D1
// option.
//
// It must not interfere with link navigation: the click listener only RECORDS the
// URL and marks the row; it never preventDefault()s, so the browser navigates as
// usual. And it must cooperate with <ClientRouter /> (Layout.astro): it re-applies
// marks on every astro:page-load (and the initial DOMContentLoaded), and the
// document-level click listener survives <main> swaps because document is never
// replaced — both idempotent (re-applying a mark is a no-op).
//
// Pure DOM logic (no Astro/runtime imports), so it's unit-tested in the node
// project under a per-file happy-dom environment (test/visited.test.ts) inside the
// 100% src/** gate.

// The localStorage key holding the set of opened article URLs (a JSON string
// array). Per-device; cleared with the browser's site data.
const STORE_KEY = 'visited-urls';

// Read the opened-URL set from localStorage. Tolerates every failure mode —
// storage disabled/quota'd (private mode), absent key, or a corrupt/non-array
// value — by returning an empty set rather than throwing, so a broken store just
// means "nothing visited yet" instead of breaking the feed.
function readVisited(): Set<string> {
	try {
		const raw = localStorage.getItem(STORE_KEY);
		if (raw === null) return new Set();
		const parsed: unknown = JSON.parse(raw);
		// A non-array (corrupt/legacy value) is ignored — start from empty.
		if (!Array.isArray(parsed)) return new Set();
		// Keep only string entries, so a malformed element can't poison the set.
		return new Set(parsed.filter((u): u is string => typeof u === 'string'));
	} catch {
		return new Set();
	}
}

// Persist the opened-URL set. Swallows a write failure (storage disabled/full):
// the in-memory mark applied this session still shows; it just won't survive a
// reload. Never throws into a click handler that's mid-navigation.
function writeVisited(urls: Set<string>): void {
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify([...urls]));
	} catch {
		// No-op: a non-persisting store degrades to session-only marks.
	}
}

// Mark a single row visited in the DOM: set the attribute the [data-visited] CSS
// keys off (revealing the agate "Opened" tag). Idempotent — re-setting an already
// -present attribute is a harmless no-op, so re-running over a marked row is safe.
function markRow(row: HTMLElement): void {
	row.setAttribute('data-visited', '');
}

// Apply stored visited marks to every feed row currently in the document. Each row
// carries its article URL in data-visited-url (Article.astro); a row whose URL is
// in the stored set gets the marker. Called on first load and after each
// ClientRouter swap, so freshly-rendered rows pick up their marks.
export function applyVisitedMarks(): void {
	const visited = readVisited();
	// Nothing opened yet → nothing to mark; skip the row sweep entirely.
	if (visited.size === 0) return;
	const rows = document.querySelectorAll<HTMLElement>('[data-visited-url]');
	for (const row of rows) {
		const url = row.dataset.visitedUrl;
		// String() collapses an absent attribute to "undefined" (never in the set),
		// so the membership test is a single branch-free expression.
		if (visited.has(String(url))) markRow(row);
	}
}

// Record that an article link was opened: persist its URL and mark its row now, so
// the indicator appears immediately (not only on the next render). Driven by the
// delegated click listener below; never preventDefault()s, so navigation proceeds.
function recordOpened(row: HTMLElement, url: string): void {
	const visited = readVisited();
	visited.add(url);
	writeVisited(visited);
	markRow(row);
}

// Delegated click handler on document: when a click lands inside a feed row's
// article link, record that row's URL as opened. Delegation (one document-level
// listener) means it survives ClientRouter <main> swaps without rebinding, exactly
// like the enhance-forms submit listener. It only reads + records — no
// preventDefault — so the link still navigates.
function onClick(event: MouseEvent): void {
	const target = event.target;
	// Event targets can be non-Element nodes (text nodes); guard before closest().
	if (!(target instanceof Element)) return;
	// The article link is marked data-visited-link; closest() finds it whether the
	// click landed on the <a> or a descendant (the <h2> headline inside it).
	const link = target.closest<HTMLElement>('[data-visited-link]');
	if (!link) return;
	const row = link.closest<HTMLElement>('[data-visited-url]');
	const url = row?.dataset.visitedUrl;
	// A link outside a row, or a row without its URL, has nothing to record.
	if (!row || url === undefined) return;
	recordOpened(row, url);
}

// Bind the click listener ONCE on document (it survives ClientRouter swaps), and
// re-apply stored marks on first load and after every ClientRouter navigation.
// astro:page-load fires on the initial page too, but DOMContentLoaded covers the
// no-ClientRouter case; both calls are idempotent (re-marking is a no-op).
document.addEventListener('click', onClick);
document.addEventListener('astro:page-load', applyVisitedMarks);
document.addEventListener('DOMContentLoaded', applyVisitedMarks);
