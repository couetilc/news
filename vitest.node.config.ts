/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { getViteConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Node-environment project for the two things better hosted outside the worker
// pool:
//   • src/pages/index.astro via the Astro Container API — needs Astro's Vite
//     plugins, which the worker pool can't load.
//   • src/worker.ts — the trivial worker entry. Its workerd-specific imports
//     (the Astro handler and the ingest run) are mocked and the DB is an opaque
//     pass-through, so it needs no real workerd. Running it here makes Istanbul
//     coverage for the async `scheduled` handler deterministic; under the worker
//     pool that coverage was intermittently dropped, red-failing the 100% gate
//     at random (#37).
// The page imports `cloudflare:workers`, which doesn't exist outside workerd, so
// it's aliased to a stub here; the page's data access (listItems) is mocked in
// the test, and the worker entry's real D1 behavior is covered by the workers
// project (run.test.ts / db.test.ts).
export default getViteConfig(
	{
		// The page pulls in src/styles/global.css (`@import "tailwindcss"`).
		// astro.config registers this plugin too, but this project loads with
		// configFile:false and can't see it — register it here so the CSS
		// transforms exactly as in the real build. Keep both in sync.
		plugins: [tailwindcss()],
		resolve: {
			alias: {
				'cloudflare:workers': fileURLToPath(
					new URL('./test/helpers/cloudflare-workers.ts', import.meta.url),
				),
				// src/middleware.ts imports `defineMiddleware` from the astro:middleware
				// virtual module (just an identity passthrough). configFile:false means
				// Astro's vite plugin that provides that virtual isn't loaded, so point
				// the bare specifier at Astro's real re-export.
				'astro:middleware': fileURLToPath(
					new URL('./node_modules/astro/dist/virtual-modules/middleware.js', import.meta.url),
				),
			},
		},
		test: {
			name: 'node',
			environment: 'node',
			include: [
				'test/agents-md.test.ts',
				'test/index.test.ts',
				'test/feed.test.ts',
				'test/layout.test.ts',
				// PinnedLinks.astro render (#316) — Container API, needs Astro's Vite
				// plugins the worker pool can't load (same as the other .astro specs).
				'test/pinned-links.test.ts',
				'test/status.test.ts',
				// Pure-node deployInfo() unit spec (imports only vitest + deploy.ts) —
				// split out of status.test.ts so deploy.ts is mutation-reachable (#236).
				'test/deploy.test.ts',
				// Plain-node sourceMeta() unit spec (#326) — reads the registry + CSS off
				// disk via node:fs for the swatch↔token cross-check, so node project.
				'test/source-meta.test.ts',
				'test/public.test.ts',
				'test/article.test.ts',
				'test/worker.test.ts',
				'test/auth-pages.test.ts',
				'test/middleware.test.ts',
				// Browser-only client modules (src/scripts/*.ts) — run under a per-file
				// `@vitest-environment happy-dom` override (declared in the spec) so
				// document/HTMLFormElement/SubmitEvent/IntersectionObserver resolve. They
				// live here, not the worker pool, which can't honor a DOM environment
				// override.
				'test/enhance-forms.test.ts',
				'test/infinite-scroll.test.ts',
				'test/opened.test.ts',
				// Stryker mutate-scope enforcement (#229) — reads sources +
				// stryker.config.json off disk via node:fs (the workers pool can't).
				'test/stryker-scope.test.ts',
				// ── Pure functional-core specs (#349) ─────────────────────────────
				// These exercise pure, I/O-free modules (parsers, normalization,
				// validators, pagination math, the log/email helpers) and import only
				// vitest, the module under test, and ?raw fixtures — never
				// cloudflare:test or D1. They run here (plain node) so the workers
				// pool stays scoped to real-runtime integration tests; the same specs
				// are what Stryker's plain-node config replays for mutation testing
				// (vitest.stryker.config.ts).
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
			],
		},
	},
	{
		// See vitest.config.ts note: don't load astro.config.mjs (Cloudflare
		// adapter plugin is incompatible with the test pipeline).
		configFile: false,
	},
);
