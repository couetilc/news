// Mark-read-on-open beacon (#334): opening an article from the logged-in feed
// marks it read server-side, so on the next render it has left Unread and sits
// in the "Recently viewed" lane above the list. This REPLACES the localStorage
// "Opened" tag (#263's visited.ts): opened-state now lives in D1 (item_reads),
// per-user and cross-device, not per-browser.
//
// Mechanics: one delegated click listener on document (survives <ClientRouter />
// <main> swaps, exactly like enhance-forms.ts). When a click lands inside an
// article link that carries data-opened-link — emitted by Article.astro ONLY on
// the interactive (logged-in) feed, so the anonymous public feed never fires a
// write the middleware would just bounce — it POSTs the row's item id to
// /api/read with read=1: the SAME authenticated endpoint, id guard, and
// idempotent upsert the read-square toggle uses. It never preventDefault()s, so
// the browser navigates to the article as usual; with JS off the click simply
// doesn't update the lane (the no-JS read square remains the manual path).
//
// The POST races the navigation tearing this page down, so it's sent with
// navigator.sendBeacon — queued by the browser to survive unload — falling back
// to fetch({ keepalive: true }) where sendBeacon is missing or refuses (its
// in-flight quota). Fire-and-forget: the 303 the endpoint answers with is
// irrelevant here, and a lost beacon just means the item stays unread — the
// reader can still use the square.
//
// Pure DOM logic (no Astro/runtime imports), unit-tested in the node project
// under a per-file happy-dom environment (test/opened.test.ts) inside the 100%
// src/** gate; the Playwright e2e (e2e/recently-viewed.spec.ts) covers the real
// click → navigate → lane round-trip.

// Send the mark-read POST so it survives the imminent navigation. sendBeacon
// returns false when the browser refuses to queue it (quota); then — or when the
// API is absent altogether — fall back to a keepalive fetch. A rejected fetch is
// swallowed: never throw out of a click handler mid-navigation.
function sendOpened(body: FormData): void {
	if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/read', body)) {
		return;
	}
	fetch('/api/read', { method: 'POST', body, keepalive: true }).catch(() => {
		// No-op: the item stays unread; the read square remains the manual path.
	});
}

// Delegated click handler: when a click lands inside an interactive feed row's
// article link, beacon that row's item id as read. Only reads + posts — no
// preventDefault — so the link still navigates.
function onClick(event: MouseEvent): void {
	const target = event.target;
	// Event targets can be non-Element nodes (text nodes); guard before closest().
	if (!(target instanceof Element)) return;
	// data-opened-link marks the article <a> on interactive rows only; closest()
	// finds it whether the click hit the <a> or the <h2> headline inside it.
	const link = target.closest<HTMLElement>('[data-opened-link]');
	if (!link) return;
	const row = link.closest<HTMLElement>('[data-item-id]');
	const id = row?.dataset.itemId;
	// A link outside a row, or a row without its id, has nothing to record.
	if (!row || id === undefined) return;
	const body = new FormData();
	body.set('id', id);
	body.set('read', '1');
	sendOpened(body);
}

// Bind ONCE on document: ClientRouter never replaces document, so the listener
// survives every page swap without rebinding (#155's delegation pattern).
document.addEventListener('click', onClick);
