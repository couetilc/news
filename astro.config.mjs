// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';

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
});
