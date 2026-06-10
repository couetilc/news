---
name: Tailwind CSS
description: How Tailwind CSS v4 is configured in this Astro 6 + Cloudflare project — the Vite-plugin setup, CSS-first configuration, where styles live, and the conventions (mobile-first, utility-first) every styling change must follow.
when_to_use: Writing or reviewing any styling change; adding a new page or layout; touching global.css or astro.config.mjs Vite plugins; debugging missing styles in dev, prod, or tests; deciding where a design token or component style should live.
---

# Tailwind CSS in this repo

## Setup (what exists and why)

- **Tailwind v4 via `@tailwindcss/vite`**, registered in `astro.config.mjs`
  under `vite.plugins`. This is the current Astro-recommended integration.
  Do NOT add `@astrojs/tailwind` — that integration is deprecated and
  Tailwind-v3-era.
- **No `tailwind.config.js` — and don't create one.** v4 is configured in
  CSS: `src/styles/global.css` is the single entry point, containing
  `@import 'tailwindcss'`, plugin registrations (`@plugin`), and future
  design tokens (`@theme`).
- **`@tailwindcss/typography` is installed** and registered via `@plugin`
  in `global.css`. Its `prose` classes are the designated tool for styling
  rendered article HTML once the aggregator displays article content.
- **`src/layouts/Layout.astro` imports `global.css`** and owns `<head>`.
  Every page must render inside this layout — a page that doesn't ships
  with no styles at all. This is the most likely cause of an "unstyled
  page" bug.

## Conventions

- **Mobile-first, always.** Unprefixed utilities are the small-screen base;
  layer `sm:` / `md:` / `lg:` upward to enhance for larger screens. `max-*`
  variants are an exception that needs a justifying comment.
- **Utility-first.** Style in markup with utility classes. Avoid `@apply`;
  when markup repeats, extract an Astro component, not a CSS class.
- **Design tokens go in `@theme`** in `global.css` (colors, fonts, spacing),
  not in scattered arbitrary values. Until a real design emerges, stick to
  Tailwind's default palette/scale.
- **Never build class names dynamically.** Tailwind statically scans source
  for complete class strings; `text-${color}` silently produces no CSS. Use
  full literal class names, or a lookup map from value → complete class.
- **Dark mode: deliberately not implemented yet.** No `dark:` variants until
  the design takes shape. When it's added, default to the zero-JS
  `prefers-color-scheme` behavior unless a manual toggle is specifically
  wanted.
- **Class ordering is automated**: `prettier-plugin-tailwindcss` sorts
  classes. Run `npm run format` before committing; don't hand-sort.

## How it behaves per environment

| Environment                        | How Tailwind runs                                                                                                                                     | Verify with                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Dev (`npm run dev`, workerd)       | Vite plugin compiles on demand; CSS inlined/served by the dev server                                                                                  | `curl -s localhost:4321 \| grep 'tailwindcss v'`       |
| Prod (`npm run build` → CI deploy) | Compiled at build time into `dist/client/_astro/*.css`, fingerprinted + immutable-cached                                                              | `grep -rl 'max-w-2xl' dist/client/_astro/` after build |
| Tests (`npm test`)                 | **Not loaded at all** — `vitest.config.ts` sets `configFile: false`, so neither the Cloudflare nor Tailwind Vite plugin runs; CSS imports are stubbed | Tests assert markup/classes, never computed styles     |
| Agentic/cloud sessions             | Nothing special: the oxide native binary arrives via `npm install`; compilation is fully local, no CDN, no runtime network                            | Same three commands as above                           |

Implications of the test row: never write a test that depends on a CSS rule
existing, and never reach for the Tailwind Play CDN (it would break the
no-network test policy and is unsuitable for production anyway).

## Decisions log

- v4 Vite plugin over deprecated `@astrojs/tailwind` integration (2026-06).
- CSS-first config; no JS config file (2026-06).
- Typography plugin installed up front for future article rendering (2026-06).
- Dark mode deferred until a design exists (2026-06).
- Prettier + `prettier-plugin-tailwindcss` + `prettier-plugin-astro` adopted
  repo-wide as part of this setup — the repo had no formatter before (2026-06).
