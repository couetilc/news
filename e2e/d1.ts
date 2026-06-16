import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Talk to the SAME local D1 the dev server uses. `astro dev` (workerd via the
// Cloudflare Vite plugin) and `wrangler d1 execute NEWS_DB --local` both default
// to the .wrangler/state/v3/d1 persistence dir, so a row the browser writes
// through the app is visible here and vice-versa (verified for issue #124). Used
// by global-setup (reset) and the auth spec (assert the row count).

// Invoke the repo-pinned wrangler binary directly. (`npm exec wrangler …`
// swallows the trailing --json/--command flags as npm's own.)
const WRANGLER = fileURLToPath(new URL('../node_modules/.bin/wrangler', import.meta.url));
const DB_ARGS = ['d1', 'execute', 'NEWS_DB', '--local'];

// Run one SQL command against local D1 and return its parsed `results` rows.
export function d1Query<T = Record<string, unknown>>(sql: string): T[] {
	const out = execFileSync(WRANGLER, [...DB_ARGS, '--json', '--command', sql], {
		encoding: 'utf8',
		// wrangler prints progress chatter to stderr; keep it off the test output.
		stdio: ['ignore', 'pipe', 'ignore'],
	});
	// `--json` emits an array of statement results; we run a single statement.
	const parsed = JSON.parse(out) as Array<{ results: T[] }>;
	return parsed[0]?.results ?? [];
}

// Apply committed migrations to local D1 (idempotent — already-applied ones are
// skipped) so a fresh worktree's empty state has the `users` table.
export function applyLocalMigrations(): void {
	execFileSync(WRANGLER, ['d1', 'migrations', 'apply', 'NEWS_DB', '--local'], {
		encoding: 'utf8',
		stdio: 'ignore',
	});
}

// Empty the users table so the first-signup path is deterministic.
export function resetUsers(): void {
	d1Query('DELETE FROM users');
}
