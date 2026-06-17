#!/usr/bin/env -S npx tsx
/**
 * backfill-entities.ts — one-off HTML-entity decode backfill (#264).
 *
 * The ingest-time decode (#224 / #240) is FORWARD-ONLY: it cleans rows written
 * after it deployed, but rows already in D1 from before still hold a literal
 * `&#039;` etc. And `insertItems` is `ON CONFLICT DO NOTHING` (src/ingest/db.ts),
 * so a re-poll of the same article dedupes on (source, guid)/(source, url) and
 * never rewrites the stale title — the bad row is frozen until it ages out (and
 * a firehose feed's aged-out items don't come back, so it effectively never
 * heals). This walks every row and rewrites the plain-text `title`/`summary`
 * columns through the SAME canonical decoder the parsers use
 * (src/ingest/parse/entities.ts), so it can't drift from ingest behaviour and
 * handles named + decimal/hex + double-encoded (`&amp;#039;`) refs in one place.
 *
 * Idempotent: decodeEntities is a fixed point on already-plain text, and we only
 * UPDATE rows whose decoded value actually DIFFERS — so an already-clean table
 * is a pure no-op and re-running is safe.
 *
 * This is a maintenance SCRIPT, not a Worker route — it carries no auth surface
 * and ships nothing to production. Run it from a machine/container with a
 * CLOUDFLARE_API_TOKEN that has D1 edit scope (wrangler reads `.env` natively).
 *
 *   # Dry run first (reads only, prints what would change):
 *   npx tsx scripts/backfill-entities.ts --remote
 *   # Then apply:
 *   npx tsx scripts/backfill-entities.ts --remote --apply
 *
 * Use --local instead of --remote to target the local dev D1 (for testing).
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeEntities, decodeText } from '../src/ingest/parse/entities';

// The D1 binding name (wrangler.jsonc d1_databases[].binding).
const DB = 'NEWS_DB';

interface Row {
	id: number;
	title: string;
	summary: string | null;
}

interface Update {
	id: number;
	title: string;
	summary: string | null;
}

function usage(msg?: string): never {
	if (msg) process.stderr.write(`backfill-entities: ${msg}\n`);
	process.stderr.write(
		'usage: npx tsx scripts/backfill-entities.ts (--local | --remote) [--apply]\n' +
			'  --local / --remote   which D1 to target (required, pick exactly one)\n' +
			'  --apply              write the changes (default: dry run, reads only)\n',
	);
	process.exit(msg ? 1 : 0);
}

function parseArgs(argv: string[]): { target: 'local' | 'remote'; apply: boolean } {
	const local = argv.includes('--local');
	const remote = argv.includes('--remote');
	if (local === remote) usage('pick exactly one of --local or --remote');
	return { target: local ? 'local' : 'remote', apply: argv.includes('--apply') };
}

// Run `wrangler d1 execute NEWS_DB <args>` and return its stdout.
function wrangler(args: string[]): string {
	return execFileSync('npx', ['wrangler', 'd1', 'execute', DB, ...args], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024 * 1024,
	});
}

// wrangler --json can print a notice banner before the JSON, so slice from the
// first '[' to the last ']'. `d1 execute --json` → [{ results: [...], ... }].
function parseRows(stdout: string): Row[] {
	const start = stdout.indexOf('[');
	const end = stdout.lastIndexOf(']');
	if (start === -1 || end === -1) {
		throw new Error(`unexpected wrangler --json output:\n${stdout}`);
	}
	const parsed = JSON.parse(stdout.slice(start, end + 1)) as Array<{ results?: Row[] }>;
	return parsed[0]?.results ?? [];
}

// A SQLite string literal: wrap in single quotes and double any internal quote.
// That is the only escaping SQLite string literals require; NULL stays a bare
// keyword (so a missing summary is restored as NULL, not the string 'null').
function sqlLit(value: string | null): string {
	return value === null ? 'NULL' : `'${value.replace(/'/g, "''")}'`;
}

// Decode each row through the canonical decoder and keep only the rows whose
// title and/or summary actually changes — clean rows produce nothing.
function planUpdates(rows: Row[]): Update[] {
	const updates: Update[] = [];
	for (const row of rows) {
		const title = decodeEntities(row.title);
		const summary = decodeText(row.summary);
		if (title !== row.title || summary !== row.summary) {
			updates.push({ id: row.id, title, summary });
		}
	}
	return updates;
}

function main(): void {
	const { target, apply } = parseArgs(process.argv.slice(2));
	const flag = `--${target}`;

	process.stderr.write(`Reading items from ${target} D1 …\n`);
	const rows = parseRows(
		wrangler([flag, '--json', '--command', 'SELECT id, title, summary FROM items']),
	);
	const updates = planUpdates(rows);

	process.stdout.write(`scanned ${rows.length} rows, ${updates.length} need decoding\n`);
	for (const u of updates.slice(0, 10)) {
		const before = rows.find((r) => r.id === u.id);
		process.stdout.write(`  #${u.id}: ${JSON.stringify(before?.title)} → ${JSON.stringify(u.title)}\n`);
	}
	if (updates.length > 10) process.stdout.write(`  … and ${updates.length - 10} more\n`);

	if (updates.length === 0) {
		process.stdout.write('nothing to do (already clean).\n');
		return;
	}
	if (!apply) {
		process.stdout.write('\ndry run — re-run with --apply to write these changes.\n');
		return;
	}

	const sql = updates
		.map(
			(u) =>
				`UPDATE items SET title=${sqlLit(u.title)}, summary=${sqlLit(u.summary)} WHERE id=${u.id};`,
		)
		.join('\n');
	const file = join(mkdtempSync(join(tmpdir(), 'backfill-')), 'backfill.sql');
	writeFileSync(file, `${sql}\n`);

	process.stderr.write(`Applying ${updates.length} updates to ${target} D1 …\n`);
	wrangler([flag, '--yes', '--file', file]);
	process.stdout.write(`done — rewrote ${updates.length} rows.\n`);
}

main();
