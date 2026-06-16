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
	// Apply local D1 migrations and empty the `users` table once, before the run,
	// so the first-signup path is deterministic (issue #124).
	globalSetup: './e2e/global-setup.ts',
	// Start the real app (astro dev on workerd) for the run. `astro dev` and
	// `wrangler d1 execute NEWS_DB --local` share the same .wrangler/state/v3/d1
	// persistence, so the globalSetup reset and the in-test assertions see the
	// same database the browser writes to. Bind to 127.0.0.1 to match BASE_URL.
	webServer: {
		command: 'npm run dev -- --host 127.0.0.1',
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
	},
});
