// Validate the "return to this view" target carried through the read/unread
// toggle (#80). The toggle is a no-JS form POST → 303 redirect, so the desired
// view (active ?source filter + active ?tab) has to ride along in the request
// and the endpoint redirects back to it. That value is client-supplied, so it
// MUST be validated before it becomes a Location header — an unvalidated
// redirect target is a classic open-redirect (an attacker crafts a link that
// POSTs and bounces the victim off to //evil.com).
//
// The contract: the only safe target is a same-origin, app-relative path. We
// reject anything that could escape the origin — protocol-relative `//host`,
// the backslash variant `/\host`, and any `scheme:` URL — and we rebuild the
// path from scratch carrying only the params the homepage actually understands
// (`source`, `tab`). Anything missing or invalid falls back to '/'.

// The homepage's query vocabulary: the source filter (#41, repeatable) and the
// active feed tab (#151, unread|read). Any other param is dropped on the way
// back so the return target can't be used to smuggle arbitrary state. The
// infinite-scroll ?offset cursor is deliberately NOT carried — a toggle returns
// to the top of the active tab (its first 50, re-rendered fresh), which the
// scroll restarts from; smuggling a deep offset back would render a partial
// view starting mid-list.
const ALLOWED_PARAMS = new Set(['source', 'tab']);

export function safeReturnPath(raw: FormDataEntryValue | string | null): string {
	// Missing, a File upload, or empty/whitespace -> home.
	if (typeof raw !== 'string') return '/';
	const value = raw.trim();
	if (value === '') return '/';

	// Split off the query once; everything before the first '?' is the path.
	const qIndex = value.indexOf('?');
	const path = qIndex === -1 ? value : value.slice(0, qIndex);
	const query = qIndex === -1 ? '' : value.slice(qIndex + 1);

	// The path must be exactly the homepage. Reject anything that isn't a single
	// app-relative '/':
	//  - protocol-relative '//evil.com' and absolute 'https://evil.com' (their
	//    path part isn't '/'),
	//  - the backslash escape '/\evil.com' (browsers treat '\' like '/'),
	//  - any deeper path ('/status', '/api/read'): the toggle only returns to the
	//    feed.
	// One check covers them all: only the literal '/' is a valid return path.
	if (path !== '/') return '/';

	// Rebuild the query carrying ONLY the known params, in their original order,
	// so the redirect target is canonical and cannot carry anything unexpected
	// (decoding is delegated to URLSearchParams).
	const out = new URLSearchParams();
	for (const [key, val] of new URLSearchParams(query)) {
		if (ALLOWED_PARAMS.has(key)) out.append(key, val);
	}
	const qs = out.toString();
	return qs ? `/?${qs}` : '/';
}
