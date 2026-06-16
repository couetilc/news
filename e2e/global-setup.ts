import { applyLocalMigrations, resetUsers } from './d1';

// Playwright globalSetup (issue #124): make the first-signup path deterministic
// before the auth spec runs. Apply committed migrations to the local D1 (a fresh
// worktree starts with no `users` table) then empty the table. Runs once per
// `npm run test:e2e`, before the webServer-backed specs.
export default function globalSetup(): void {
	applyLocalMigrations();
	resetUsers();
}
