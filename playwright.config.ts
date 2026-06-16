import { defineConfig, devices } from '@playwright/test';

// The smallest checked-in Playwright setup (issue #124): drive the auth forms in
// a REAL browser so the ClientRouter-vs-document-navigation behavior (and the
// first-signup → signed-in-homepage flow) is covered the way vitest can't —
// vitest mocks the action or renders the .astro directly and never sees the
// client-router interception. This runs ONLY via `npm run test:e2e`; it is
// deliberately OUTSIDE the hermetic `npm test` suite and its 100% src/**
// coverage gate (see CLAUDE.md "Testing policy"). CI wiring is #77's job.

// The local dev URL. In the agent container the host port is randomized and
// exposed as $DEV_HOST_4321, but inside the container the dev server still
// listens on 127.0.0.1:4321 — which is also what `webServer` starts below — so
// the in-container browser talks to it directly.
const BASE_URL = 'http://127.0.0.1:4321';

export default defineConfig({
	testDir: './e2e',
	// One worker / fully serial: these specs reset and assert against the single
	// shared local D1 `users` table (globalSetup empties it), so they must not run
	// concurrently against the same row.
	workers: 1,
	fullyParallel: false,
	// Local-iteration tool, not (yet) a CI gate — fail fast, no retries.
	retries: 0,
	reporter: [['list']],
	use: {
		baseURL: BASE_URL,
		trace: 'retain-on-failure',
	},
	projects: [
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				// Non-root Chromium in the agent container can't use the sandbox
				// (throwaway container, so that's fine) — see CLAUDE.md / the
				// agentic-environments skill. Outside the container this is harmless.
				launchOptions: { args: ['--no-sandbox'] },
			},
		},
	],
	// Empty the `users` table once, before the run, so the first-signup path is
	// deterministic (issue #124). Schema creation does NOT live here — it must
	// happen before the webServer readiness probe (see the webServer command
	// below), because Playwright starts the webServer and waits for its `url` to
	// answer BEFORE globalSetup runs.
	globalSetup: './e2e/global-setup.ts',
	// Start the real app (astro dev on workerd) for the run. Apply the committed
	// local D1 migrations FIRST, in the same command, so the schema exists before
	// the `url` readiness probe below hits `/`. On a fresh local D1 `/` queries
	// `items` and would otherwise 500 with "no such table: items", so the probe
	// would never see a ready server and the whole run would time out before any
	// spec — or even globalSetup — ran (issue #156). `wrangler d1 migrations apply
	// --local` (what `db:migrate:local` runs) and `astro dev` (workerd via the
	// Cloudflare Vite plugin) share the same .wrangler/state/v3/d1 persistence dir,
	// so the schema this step creates is the same DB the dev server, the
	// globalSetup reset, and the in-test assertions all see. Bind to 127.0.0.1 to
	// match BASE_URL.
	webServer: {
		command: 'npm run db:migrate:local && npm run dev -- --host 127.0.0.1',
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
