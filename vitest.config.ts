/// <reference types="vitest" />
import { getViteConfig } from 'astro/config';

export default getViteConfig(
	{
		test: {
			coverage: {
				provider: 'v8',
				include: ['src/**'],
				// Hard gate: the suite fails below 100% line/branch coverage.
				thresholds: {
					lines: 100,
					branches: 100,
				},
			},
		},
	},
	{
		// Don't load astro.config.mjs: the Cloudflare adapter's Vite plugin is
		// incompatible with vitest's node environment, and rendering components
		// through the Container API doesn't need an adapter.
		configFile: false,
	},
);
