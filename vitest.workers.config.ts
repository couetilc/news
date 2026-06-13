/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

// Worker-runtime tests: ingest pipeline, D1 access, parsers, worker entry.
// Runs inside workerd with a real local D1 so `cloudflare:workers` env and
// `ON CONFLICT` dedupe behave exactly as in production. The .astro homepage
// test lives in the node project (vitest.node.config.ts) instead.
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
		exclude: ['test/index.test.ts'],
		setupFiles: ['./test/helpers/apply-migrations.ts'],
	},
});
