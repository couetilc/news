/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// Worker-runtime tests: ingest pipeline, D1 access, parsers. Runs inside
// workerd with a real local D1 so `cloudflare:workers` env and `ON CONFLICT`
// dedupe behave exactly as in production. The .astro homepage test and the
// trivial worker-entry test live in the node project (vitest.node.config.ts):
// the homepage needs Astro's Vite plugins, and worker.ts's coverage was flaky
// under this pool (#37 — the async `scheduled` body wasn't always recorded).
export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			miniflare: {
				compatibilityDate: '2026-06-10',
				compatibilityFlags: ['nodejs_compat'],
				d1Databases: ['NEWS_DB'],
				// Migrations are read here and applied per test file by the setup
				// file via the cloudflare:test applyD1Migrations helper.
				bindings: { TEST_MIGRATIONS: await readD1Migrations('migrations') },
			},
		})),
	],
	test: {
		name: 'workers',
		include: ['test/**/*.test.ts'],
		// Node-project tests (Astro Container API page renders + the middleware
		// guard, which imports the astro:middleware virtual module) can't run under
		// the worker pool — they live in vitest.node.config.ts.
		exclude: [
			'test/agents-md.test.ts',
			'test/index.test.ts',
			'test/feed.test.ts',
			'test/layout.test.ts',
			'test/status.test.ts',
			'test/public.test.ts',
			'test/article.test.ts',
			'test/worker.test.ts',
			'test/auth-pages.test.ts',
			'test/middleware.test.ts',
			// DOM unit tests for browser-only client modules — need a happy-dom
			// environment the workerd pool can't provide; they run in the node project.
			'test/enhance-forms.test.ts',
			'test/infinite-scroll.test.ts',
			// Reads sources + stryker.config.json off disk via node:fs — runs in the
			// node project, not the workerd pool (#229).
			'test/stryker-scope.test.ts',
		],
		setupFiles: ['./test/helpers/apply-migrations.ts'],
	},
});
