// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
	// SSR for all pages by default: a news aggregator serves fresh content.
	// Individual pages can opt back into prerendering with `export const prerender = true`.
	output: 'server',
	adapter: cloudflare({
		// Build-time image optimization only; avoids a dependency on Cloudflare
		// Images billing. Switch to 'cloudflare-binding' if we ever transform
		// external article images at runtime.
		imageService: 'compile',
	}),
	vite: {
		// Tailwind v4 hooks in as a Vite plugin (the @astrojs/tailwind
		// integration is deprecated, v3-era). Not loaded in vitest — see
		// .claude/skills/tailwind-css/SKILL.md.
		plugins: [tailwindcss()],
	},
});
