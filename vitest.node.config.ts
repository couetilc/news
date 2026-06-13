/// <reference types="vitest" />
import { fileURLToPath } from 'node:url';
import { getViteConfig } from 'astro/config';

// Node-environment project for the one thing the worker pool can't host: the
// Astro Container API rendering src/pages/index.astro. The page imports
// `cloudflare:workers`, which doesn't exist outside workerd, so it's aliased to
// a stub here; the page's data access (listItems) is mocked in the test, and
// its real D1 behavior is covered by the workers project.
export default getViteConfig(
	{
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
