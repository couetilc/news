// @ts-check
import { defineConfig } from 'astro/config';

import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

// Session lifetime (issue #314). A logged-in session should last 2 weeks and an
// active user (any page request) should slide that window forward — see the
// sliding refresh in src/middleware.ts. The Cloudflare adapter forwards
// `session.cookie` / `session.ttl` straight to Astro's KV session driver
// (node_modules/@astrojs/cloudflare/dist/index.js:~100), so these two values are
// the only levers.
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 14; // 14 days, in seconds
// Keep the server-side KV record alive a little longer than the cookie so a
// still-valid cookie never points at an evicted record (both are refreshed
// together on each authenticated request, so this is just defensive slack).
const SESSION_KV_TTL = 60 * 60 * 24 * 15; // 15 days, in seconds

// https://astro.build/config
export default defineConfig({
  // SSR for all pages by default: a news aggregator serves fresh content.
  // Individual pages can opt back into prerendering with `export const prerender = true`.
  output: 'server',
  // Persist the session cookie across browser restarts. Without an explicit
  // maxAge Astro falls back to a *browser-session* cookie (no Max-Age/Expires),
  // which mobile browsers/OSes evict aggressively when backgrounding tabs — the
  // "logged out on mobile" report in #314. We only set maxAge (+ the default
  // sameSite) here: Astro forces `httpOnly` and defaults `secure` to
  // production-only, so leaving those unset keeps local http dev working while
  // production cookies stay Secure.
  session: {
    cookie: {
      maxAge: SESSION_COOKIE_MAX_AGE,
      sameSite: 'lax',
    },
    ttl: SESSION_KV_TTL,
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
