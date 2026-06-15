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
				'test/index.test.ts',
				'test/status.test.ts',
				'test/public.test.ts',
				'test/article.test.ts',
				'test/worker.test.ts',
				'test/auth-pages.test.ts',
				'test/middleware.test.ts',
			],
		},
	},
	{
		// See vitest.config.ts note: don't load astro.config.mjs (Cloudflare
		// adapter plugin is incompatible with the test pipeline).
		configFile: false,
	},
);
