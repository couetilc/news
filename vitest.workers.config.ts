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
			// PinnedLinks.astro render (#316) — Container API page render, node project.
			'test/pinned-links.test.ts',
			'test/status.test.ts',
			// Plain-node deployInfo() unit spec — runs in the node project (#236).
			'test/deploy.test.ts',
			// Plain-node sourceMeta() unit spec (#326) — reads files off disk via
			// node:fs, which the workerd pool can't; runs in the node project.
			'test/source-meta.test.ts',
			'test/public.test.ts',
			'test/article.test.ts',
			'test/worker.test.ts',
			'test/auth-pages.test.ts',
			'test/middleware.test.ts',
			// DOM unit tests for browser-only client modules — need a happy-dom
			// environment the workerd pool can't provide; they run in the node project.
			'test/enhance-forms.test.ts',
			'test/infinite-scroll.test.ts',
			'test/opened.test.ts',
			// Reads sources + stryker.config.json off disk via node:fs — runs in the
			// node project, not the workerd pool (#229).
			'test/stryker-scope.test.ts',
			// ── Pure functional-core specs (#349) — node project ──────────────────
			// Pure-module specs (parsers, normalization, validators, pagination,
			// log/email) need no workerd runtime; they run in the fast node project.
			// This pool keeps only the shell's real-runtime integration tests
			// (D1 data layer, ingest orchestration, session/crypto parity).
			'test/parse-atom.test.ts',
			'test/parse-rss20.test.ts',
			'test/parse-aws-whats-new.test.ts',
			'test/parse-sec-edgar.test.ts',
			'test/parse-ti-newsroom.test.ts',
			'test/parse-thinking-machines-news.test.ts',
			'test/parse-jpm-eotm.test.ts',
			'test/parse-owenomics.test.ts',
			'test/parse-cursor.test.ts',
			'test/parse-entities.test.ts',
			'test/parse-fuzz.test.ts',
			'test/count.test.ts',
			'test/dates.test.ts',
			'test/validate.test.ts',
			'test/sources.test.ts',
			'test/pagination.test.ts',
			'test/pagination.prop.test.ts',
			'test/return-path.test.ts',
			'test/log.test.ts',
			'test/email.test.ts',
			'test/auth-validate.test.ts',
			'test/auth-validate.prop.test.ts',
			// The extracted functional-core modules (#349) — node project.
			'test/schedule.test.ts',
			'test/schedule.prop.test.ts',
			'test/merge.test.ts',
			'test/merge.prop.test.ts',
			'test/queries.test.ts',
			'test/digest.test.ts',
			'test/digest.prop.test.ts',
		],
		setupFiles: ['./test/helpers/apply-migrations.ts'],
	},
});
