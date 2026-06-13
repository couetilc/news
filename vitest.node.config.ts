/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { getViteConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Node-environment project for the one thing the worker pool can't host: the
// Astro Container API rendering src/pages/index.astro. The page imports
// `cloudflare:workers`, which doesn't exist outside workerd, so it's aliased to
// a stub here; the page's data access (listItems) is mocked in the test, and
// its real D1 behavior is covered by the workers project.
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
			},
		},
		test: {
			name: 'node',
			environment: 'node',
			include: ['test/index.test.ts'],
		},
	},
	{
		// See vitest.config.ts note: don't load astro.config.mjs (Cloudflare
		// adapter plugin is incompatible with the test pipeline).
		configFile: false,
	},
);
