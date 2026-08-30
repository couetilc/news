// Pure SQL-clause decisions for the digest queries (#349), extracted from
// db.ts: the read/unread PARTITION pick and the source-filter clause are the
// only real branching the digest queries do in JS — the ordering and counting
// live in the SQL itself. As plain string builders they are node-tested
// (test/queries.test.ts pins the exact clauses) and in Stryker's mutation
// scope; db.ts interpolates the results and binds the matching placeholders.

// One `?` per source slug, matching the bind order db.ts appends them in.
function placeholders(sources: readonly string[]): string {
	return sources.map(() => '?').join(', ');
}

// The whole WHERE clause for the unpartitioned items query (listItems): filter
// to the given source slugs, or no clause at all for "All".
export function sourceWhere(sources: readonly string[]): string {
	return sources.length > 0 ? `WHERE source IN (${placeholders(sources)})` : '';
}

// The WHERE clause for the per-user section queries (listItemsByRead /
// countItemsByRead). The partition decision: a row is in the Read section iff
// this user's LEFT-JOINed item_reads row exists (`r.read_at IS NOT NULL`), and
// in the Unread section iff it doesn't — so the two clauses are exact
// complements and every item is in exactly one section. The optional source
// filter narrows within the section.
export function sectionWhere(read: boolean, sources: readonly string[]): string {
	const readClause = read ? 'r.read_at IS NOT NULL' : 'r.read_at IS NULL';
	const sourceClause = sources.length > 0 ? ` AND i.source IN (${placeholders(sources)})` : '';
	return `WHERE ${readClause}${sourceClause}`;
}
