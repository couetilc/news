// Structured logging for Cloudflare Workers Logs.
//
// Workers Logs indexes the *top-level fields* of any object passed to
// `console.*`, so you can filter/aggregate by them in the Logs UI and
// `wrangler tail` (e.g. `source = 'cf'`, `status = 304`, `event =
// 'ingest.poll'`). A pre-stringified blob would land as one opaque `message`
// field instead — so we pass the object straight through, never `JSON.stringify`
// it first. See .claude/skills/cloudflare-observability/SKILL.md.
//
// Deliberately dependency-free: workerd has no Node logging libraries, and the
// 100%-coverage / no-network rules make a thin `console.*` wrapper the right
// size. The only thing centralised here is the `event` name, so call sites stay
// consistent and every record is self-describing.

// Dotted, namespaced event names — the primary axis you filter logs on.
export type LogEvent =
	| 'ingest.poll' // a feed was polled successfully (see `outcome` for 200 vs 304)
	| 'ingest.error' // a feed fetch/parse/store failed
	| 'read.toggle'; // a digest item was marked read/unread (the one request-path mutation)

// Arbitrary indexed fields to attach to a record. Kept to JSON-friendly
// scalars: Workers Logs indexes scalars, and objects survive the no-network
// test path unchanged.
export type LogFields = Record<string, string | number | boolean | null | undefined>;

// `info` → console.log, `error` → console.error. The level picks the console
// method (so error records surface in the Logs UI's error stream) and is also
// emitted as a field for filtering.
function emit(
	level: 'info' | 'error',
	event: LogEvent,
	fields: LogFields,
): void {
	const record = { level, event, ...fields };
	if (level === 'error') {
		console.error(record);
	} else {
		console.log(record);
	}
}

export const log = {
	info(event: LogEvent, fields: LogFields = {}): void {
		emit('info', event, fields);
	},
	error(event: LogEvent, fields: LogFields = {}): void {
		emit('error', event, fields);
	},
};
