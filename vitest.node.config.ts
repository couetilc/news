/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { getViteConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { WORKER_TESTS } from './test/runtime.ts';

// Pure logic, parsers, Astro Container API renders and happy-dom client tests.
// Only the explicitly classified workerd specs are excluded. Page bindings are
// stubbed below; actual D1/KV/crypto behavior is tested in the workers project.
// The mocked worker-entry spec also runs here for deterministic Istanbul
// coverage of its async scheduled handler (#37).
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
			include: ['test/**/*.test.ts'],
			exclude: WORKER_TESTS,
		},
	},
	{
		// See vitest.config.ts note: don't load astro.config.mjs (Cloudflare
		// adapter plugin is incompatible with the test pipeline).
		configFile: false,
	},
);
