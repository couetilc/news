// Shared HTML-entity decoder for the ingest parsers (#224). Feed item text —
// titles and summaries — is plain-text display/storage data, but several feeds
// deliver it with HTML entities still embedded (the source page injected the
// text as HTML, or the feed XML is double-encoded). Left undecoded, a title like
// "grandparents matter for children&#039;s health" renders the literal `&#039;`
// to the reader instead of an apostrophe. This decodes the common named refs and
// any decimal/hex numeric ref to its final character so stored/displayed text is
// clean.
//
// This is a CHARACTER-REFERENCE decoder for PLAIN-TEXT fields, NOT HTML
// sanitization of `contentHtml`. contentHtml keeps its markup; only the
// plain-text title/summary fields are run through here.
//
// Originally lived as a private `decodeEntities` in ti-newsroom.ts; factored out
// here so every parser shares one implementation.

// The handful of named entities feeds actually emit. Numeric refs (&#39;,
// &#x27;) cover anything outside this map.
const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	nbsp: ' ',
};

// One left-to-right pass: replace every `&…;` reference. A numeric ref decodes by
// code point (decimal `&#NN;` or hex `&#xNN;`); a named ref maps through the
// table; an unrecognized named ref is left verbatim so non-entity text like a
// bare `&` survives untouched.
function decodeOnce(value: string): string {
	return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
		if (body[0] === '#') {
			// The regex requires ≥1 digit and admits a lowercase `x` only for hex
			// (`&#xNN;`); a bare `&#NN;` is decimal — so parseInt always succeeds.
			const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
			return String.fromCodePoint(code);
		}
		const named = NAMED_ENTITIES[body.toLowerCase()];
		return named ?? match;
	});
}

// Decode HTML character references in a plain-text field. Repeat-until-stable,
// because some feeds are DOUBLE-encoded: `&amp;#039;` decodes in one pass to
// `&#039;` (the `&amp;` → `&` resolves, but the now-revealed `#039;` is no longer
// preceded by a live `&`), and only a second pass turns that into `'`. We loop
// until a pass makes no change. Termination is guaranteed without an iteration
// cap: every reference replaced by a pass is at least 3 chars (`&…;`) and
// produces a shorter result, so a *changing* pass strictly shrinks the string;
// it therefore reaches a fixed point in finitely many steps. Idempotent on
// already-plain text — that stabilizes on the first pass (the loop runs once,
// sees no change, and stops).
export function decodeEntities(value: string): string {
	let current = value;
	let next = decodeOnce(current);
	while (next !== current) {
		current = next;
		next = decodeOnce(current);
	}
	return current;
}

// Null-passthrough wrapper for the optional plain-text fields (a feed's missing
// summary stays null). Lets a parser decode `title`/`summary` uniformly without
// repeating the null guard at each call site.
export function decodeText(value: string | null): string | null {
	return value === null ? null : decodeEntities(value);
}
