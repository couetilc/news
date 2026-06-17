import { defineConfig, devices } from '@playwright/test';

// The smallest checked-in Playwright setup (issue #124): drive the auth forms in
// a REAL browser so the ClientRouter-vs-document-navigation behavior (and the
// first-signup → signed-in-homepage flow) is covered the way vitest can't —
// vitest mocks the action or renders the .astro directly and never sees the
// client-router interception. This runs ONLY via `npm run test:e2e`; it is
// deliberately OUTSIDE the hermetic `npm test` suite and its 100% src/**
// coverage gate (see CLAUDE.md "Testing policy"). CI wiring is #77's job.

// The local server URL. In the agent container the host port is randomized and
// exposed as $DEV_HOST_4321, but inside the container the server still listens on
// 127.0.0.1:4321 — which is also what `webServer` starts below — so the
// in-container browser talks to it directly. (`astro preview` defaults to 4321,
// the same port `astro dev` used.)
const BASE_URL = 'http://127.0.0.1:4321';

export default defineConfig({
	testDir: './e2e',
	// One worker / fully serial: these specs reset and assert against the single
	// shared local D1 `users` table (globalSetup empties it), so they must not run
	// concurrently against the same row.
	workers: 1,
	fullyParallel: false,
	// Local: fail fast, no retries. CI (issue #77): one retry as a thin safety net.
	// The real stability fix (issue #257) is serving a BUILT worker via
	// `astro preview` instead of `astro dev` (see `webServer` below) — `dev`
	// recompiled per request and that was the source of the `ERR_EMPTY_RESPONSE` /
	// run-to-run 30s-timeout flake under sequential hits. The CI run is ADVISORY (a
	// separate non-blocking job, not the `test` gate), so the retry trims residual
	// noise without masking a real regression a reviewer would read off the
	// uploaded report. Keep the retry until the suite graduates to a blocking gate.
	retries: process.env.CI ? 1 : 0,
	// Local: a clean `list`. CI (issue #77): also emit a machine-readable `json`
	// report to a fixed path so the advisory e2e job can upload it as an artifact
	// for review tooling to diff run-over-run (new failures vs. known flakes), plus
	// `github` for inline step annotations. `list` stays for the human log either way.
	reporter: process.env.CI
		? [['list'], ['github'], ['json', { outputFile: 'playwright-report/results.json' }]]
		: [['list']],
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
	// Start the real app for the run — serving a BUILT worker via `astro preview`,
	// NOT `astro dev` (issue #257). `astro dev` recompiles on demand (Vite dev
	// server), so under this suite's sequential hits the server could be answering
	// a navigation mid-(re)compile — the `net::ERR_EMPTY_RESPONSE` on `/signup` and
	// the run-to-run 30s timeouts on a shifting failing set were that flake
	// signature, not a logic regression. `astro preview` serves the static
	// `astro build` output in workerd with no per-request compile, which removes
	// that instability.
	//
	// The command, in order: (1) `ensure-dev-vars.mjs` guarantees `.dev.vars`
	// defines AUTH_PEPPER — the production build serves fail-closed without it
	// (#189), and the Cloudflare adapter feeds preview's Worker vars from
	// `.dev.vars` (gitignored, so absent in CI); see that script's header; (2)
	// `db:migrate:local` applies the committed local D1 migrations so the schema
	// exists before the `url` readiness probe hits `/` — on a fresh local D1 `/`
	// queries `items` and would otherwise 500 with "no such table: items", so the
	// probe would never see a ready server and the whole run would time out before
	// any spec ran (issue #156); (3) `build` emits the worker `astro preview`
	// serves (it errors without a `dist/`); (4) `preview` runs the built worker.
	// `wrangler d1 … --local`, `astro build`, and `astro preview` (workerd via the
	// Cloudflare Vite plugin) all share the same .wrangler/state/v3/d1 persistence
	// dir, so the schema this step creates is the same DB the preview server, the
	// globalSetup reset, and the in-test assertions all see. Bind to 127.0.0.1 to
	// match BASE_URL.
	//
	// `timeout` is generous because the command now includes a full `astro build`
	// before the server can answer the `url` probe; Playwright polls `url` and only
	// starts the run once `/` responds, so the first navigation can't hit the
	// server before it's listening — which closes the `astro dev` window where a
	// nav could land mid-(re)compile (#257).
	webServer: {
		command:
			'node ./e2e/ensure-dev-vars.mjs && npm run db:migrate:local && npm run build && npm run preview -- --host 127.0.0.1',
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
});
