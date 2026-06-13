---
name: Design system
description: Visual and styling guidelines for the news aggregator UI — how Tailwind CSS v4 is wired in, the mobile-first rule, the light newspaper theme, the design tokens, and the conventions for building pages and components so they stay on-brand.
when_to_use: Building or restyling any page/component; adding UI; choosing colors, type, spacing, or breakpoints; touching src/styles/global.css, a .astro layout/page, or anything visual; deciding how a new screen should look; reviewing a UI change for consistency.
---

# Design system

The look and feel of https://news.cuteteal.com. Read this before writing any
markup or CSS so new UI stays consistent with the established theme.

## Inspiration: the briefing column

The north star is the newspaper **news-in-brief digest** — the *Wall Street
Journal* "What's News" rail, the *NYT* morning-briefing agate column. Its whole
job is ours: compress a long chronological list of stories into a **dense,
scannable, single serif column**, broken into a few labeled sections by hairline
rules. Two consequences fall out of that and should guide every layout call:

- **One column, top-to-bottom = chronological.** Reading order *is* time order.
  We deliberately dropped the old CSS multi-column flow because it snaked items
  across columns, so "newest" wasn't "top-left." Don't reintroduce horizontal
  chronology.
- **Density is the point.** Small headlines, tight leading, an inline agate
  dateline, hairline separators — pack many items per screen without losing the
  newsprint feel. Favor a ruled line over an airy block; favor a compact
  nameplate so stories start above the fold.

## Three rules, in priority order

1. **Mobile-first.** Connor reads this on a phone. Design every screen for a
   narrow single column first, then *progressively enhance* for wider viewports
   with Tailwind's `sm:`/`md:`/`lg:` prefixes. Unprefixed utilities are the
   phone layout; prefixed ones only ever *add* width/columns/size. Never write a
   desktop layout and bolt on mobile overrides.
2. **Light theme.** The initial and only theme is light — warm newsprint paper,
   near-black ink. No dark mode yet. Don't add `dark:` variants or a theme
   toggle until that's explicitly scoped (file an issue if it comes up).
3. **Newspaper, not web app.** The page should read like a printed paper:
   serif type, a ruled masthead with a dateline, hairline rules between items, a
   single dense digest column, small uppercase datelines. Avoid the SaaS-app
   look — no cards with drop shadows, no rounded pill buttons, no gradients-as-
   decoration, no bright accent UI. Even functional controls stay in voice: the
   read/unread toggle is a small ruled square, not a colored button. When in
   doubt, ask "would this look at home in print?"

## How Tailwind is wired in

Tailwind CSS **v4** via the Vite plugin (`@tailwindcss/vite`) — there is no
`@astrojs/tailwind` integration and no `tailwind.config.js`. Everything is
configured in CSS.

- `astro.config.mjs` registers `tailwindcss()` under `vite.plugins`. This is the
  real build path.
- `src/styles/global.css` is the single stylesheet: `@import "tailwindcss";`, the
  `@theme` token block, and a small `@layer base`. It's imported once, in
  `src/layouts/Layout.astro`, so every page that uses the layout gets it.
- **Tests:** the `node` vitest project (`vitest.node.config.ts`) renders pages
  through Astro's Container API with `configFile: false`, so it can't see the
  plugin from `astro.config`. It registers `@tailwindcss/vite` itself. If you
  ever change how the plugin is configured, change it in **both** places or the
  page-render test breaks on the unresolved `@import "tailwindcss"`.

## Design tokens

Defined in the `@theme` block in `src/styles/global.css`. Tailwind turns each
token into utilities automatically — use the utility, don't hardcode the hex.

| Token | Value | Utilities | Use for |
|---|---|---|---|
| `--color-paper` | `#f7f5ef` | `bg-paper` | page background (newsprint) |
| `--color-paper-edge` | `#efece2` | `bg-paper-edge` | zebra/panel tint |
| `--color-ink` | `#17150f` | `text-ink`, `border-ink` | body text, masthead rules |
| `--color-ink-soft` | `#3a3730` | `text-ink-soft` | secondary text (source names) |
| `--color-muted` | `#6b665b` | `text-muted` | datelines, metadata, footer |
| `--color-rule` | `#c9c3b3` | `border-rule` | hairline column/section rules |
| `--color-accent` | `#8b1a1a` | `text-accent` | sparse accent: hover, section heads |
| `--font-serif` | system serif stack | `font-serif` | body (the default on `body`) |
| `--font-headline` | system serif stack | `font-headline` | h1–h3 (set in base layer) |
| `--font-sans` | system sans stack | `font-sans` | datelines, metadata, UI chrome |

Type is **system fonts only** — no webfont fetch, so the page paints instantly
and works offline. If a display masthead face (e.g. Playfair Display) is ever
worth the bytes, swap `--font-headline` and document the trade-off here.

The accent red is for *emphasis only* (link hover, a future section header) —
keep it rare so it stays loud.

## Patterns

- **Layout shell:** `src/layouts/Layout.astro` owns `<html>`, the masthead
  (double-ruled nameplate + dateline + tagline, kept compact so stories start
  high), `<main>`, and the footer. Pages render their content as its `<slot>`.
  New top-level pages should use this layout, not re-create the chrome.
- **Container width:** the layout chrome (masthead/footer) spans
  `mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8`. A reading column — the feed —
  narrows further to `mx-auto max-w-2xl` for a comfortable line length; wrap list
  content in that, don't let headlines run the full 5xl width.
- **Rules over boxes:** separate items with `border-b border-rule`, not cards.
  Section/masthead emphasis uses `border-double border-ink`. A section divider
  with a centered label is a small-caps heading flanked by `h-px flex-1 bg-rule`
  spans (see the homepage "Read" divider).
- **Single digest column:** the feed is one `<ol>` of hairline-ruled rows, newest
  first — no CSS columns. Each row is a component (`src/components/Article.astro`):
  headline + agate dateline on the left, its control on the right, `py-2.5`
  vertical rhythm. Mobile-first: it's already one column; wider screens only bump
  the type (`sm:text-lg`), not the column count.
- **Read/unread:** `listItems` returns unread-first; the homepage splits on
  `read_at` into the live feed and a quieter **Read** section below (read rows at
  `opacity-55`, no other restyle). The toggle is a `size-4` ruled square — empty
  `border-rule` when unread, filled `border-ink bg-ink` with a `✓` when read —
  inside a `<form method="POST" action="/api/read">` so it works without JS
  (POST → 303 → reload). Reuse this square idiom for future binary state; don't
  reach for a colored pill.
- **Datelines/metadata:** `font-sans`, small (`text-[0.65rem]`–`text-xs`),
  `uppercase`, letter-spaced (`tracking-wider`/`tracking-[0.3em]`),
  `text-muted`. This is the "set in small caps under the headline" newspaper
  voice.
- **Headlines:** serif (inherited), `text-base sm:text-lg`, `leading-snug`, tight
  tracking — sized for a digest, not a feature splash. Links are plain ink that
  underline on hover (`group-hover:underline` + `group-hover:text-accent`), not
  blue web links.

## Coverage gotcha

`src/**` is under a 100% line/branch coverage gate. `.astro` components and
`src/lib/**` count. Keep presentational helpers branch-free (see
`src/lib/format.ts` — fixed name tables, no conditionals) and make sure any new
component is actually rendered by a test, or the gate fails.
