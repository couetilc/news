// Normalize an RSS/Atom date string to unix seconds UTC, or null when it's
// missing or unparseable. RFC-822 pubDates ("Tue, 10 Jun 2026 16:05:00 GMT")
// and ISO-8601 both parse via Date.parse. Storing an integer means published_at
// ordering is timezone-proof regardless of each feed's formatting quirks.
export function parseRfc822(value: string | null | undefined): number | null {
	if (!value) return null;
	const ms = Date.parse(value);
	if (Number.isNaN(ms)) return null;
	return Math.floor(ms / 1000);
}
