// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // SSR for all pages by default: a news aggregator serves fresh content.
  // Individual pages can opt back into prerendering with `export const prerender = true`.
  output: 'server',
  security: {
    // Astro's built-in cross-site form-POST guard (default ON) returns an
    // unstyled plaintext "Cross-site POST form submissions are forbidden" 403,
    // which reads as a broken page (issue #95). We turn it OFF here and
    // reimplement the exact same same-origin check in src/middleware.ts so we
    // control the response: a failed check rewrites to the in-voice
    // src/pages/403.astro instead of dumping raw text. The protection is not
    // weakened — same origin comparison, same form-content-type scope — just
    // surfaced in the newspaper voice.
    checkOrigin: false,
  },
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
    // Bake the deploy SHA / ref / build time into the worker at `astro build`
    // for the /status page (the worker can't read its own git revision at
    // runtime). CI sets GITHUB_SHA / GITHUB_REF_NAME automatically; locally
    // these are absent, so src/lib/deploy.ts falls back to 'dev' / 'local' /
    // 'unknown' (the tokens stay undefined and its `typeof` guards kick in).
    // No .github/workflows/* change needed — the build env already has them.
    define: {
      __DEPLOY_SHA__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev'),
      __DEPLOY_REF__: JSON.stringify(process.env.GITHUB_REF_NAME ?? 'local'),
      __DEPLOY_TIME__: JSON.stringify(new Date().toISOString()),
    },
  },
});
