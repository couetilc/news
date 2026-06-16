import { applyLocalMigrations, resetUsers } from './d1';

// Playwright globalSetup (issue #124): make the first-signup path deterministic
// before the auth spec runs. Runs once per `npm run test:e2e`, AFTER Playwright
// has started the webServer and its readiness probe has passed.
//
// The committed migrations are now also applied by the webServer command before
// `astro dev` (playwright.config.ts), so on a fresh local D1 the schema exists
// before the probe hits `/` instead of 500ing on a missing `items` table and
// timing the run out before this ever ran (issue #156). applyLocalMigrations()
// stays here as an idempotent belt-and-suspenders: already-applied migrations are
// skipped, and it guarantees the schema even on the `reuseExistingServer` path (a
// pre-existing dev server that predates the current migrations). Then empty the
// `users` table so the first-signup assertion starts from zero.
export default function globalSetup(): void {
	applyLocalMigrations();
	resetUsers();
}
