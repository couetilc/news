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
    // Tailwind CSS v4 integrates as a Vite plugin (no @astrojs/tailwind shim).
    // The node vitest project loads with configFile:false, so it can't see this
    // plugin — it registers @tailwindcss/vite itself so the page's CSS import
    // still resolves during the Container API render. Keep both in sync.
    plugins: [tailwindcss()],
  },
});
