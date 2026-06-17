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
rules. Two consequences guide every layout call:

- **One column, top-to-bottom = chronological.** Reading order *is* time order.
  No CSS multi-column flow — it snakes items across columns, so "newest" isn't
  "top-left." Don't introduce horizontal chronology.
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
3. **A *modern, interactive* newspaper — not a SaaS app, not a static printout.**
   The page should read like a printed paper: serif type, a ruled masthead with a
   dateline, hairline rules between items, a single dense digest column, small
   uppercase datelines. Avoid the SaaS-app look — no cards with drop shadows, no
   rounded pill buttons, no gradients-as-decoration, no bright accent UI. **But
   this is a paper you *use*, not just read:** controls that *do something* when
   clicked (links, action buttons, toggles) must be visibly distinguishable from
   static text. Print fidelity and discoverability are both required; when they
   tension, resolve it in voice (a ruled treatment, an underline, the accent on
   interaction — see **Interactive affordances** below), never by hiding the
   affordance. Functional controls still stay in voice: the read/unread toggle is
   a small ruled square, not a colored button — but it *reads as* a control at
   rest, not as a dateline glyph. When in doubt, ask both "would this look at home
   in print?" *and* "can a reader tell this is clickable without touching it?"

## How Tailwind is wired in

Tailwind CSS **v4** via the Vite plugin (`@tailwindcss/vite`) — no
`@astrojs/tailwind` integration, no `tailwind.config.js`. Everything is
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
and works offline.

The accent red is for *emphasis only* (link hover, section heads) — keep it rare
so it stays loud.

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
  (POST → 303 → reload). Reuse this square idiom for binary state; don't reach for
  a colored pill. As a control it owes the four obligations in **Interactive
  affordances** — resting ruled square, `hover:border-ink`, `focus-visible` ring,
  `cursor-pointer`.
- **Datelines/metadata:** `font-sans`, small (`text-[0.65rem]`–`text-xs`),
  `uppercase`, letter-spaced (`tracking-wider`/`tracking-[0.3em]`),
  `text-muted`. This is the "set in small caps under the headline" newspaper
  voice.
- **Headlines:** serif (inherited), `text-base sm:text-lg`, `leading-snug`, tight
  tracking — sized for a digest, not a feature splash. Links are plain ink that go
  accent + underlined on hover (`group-hover:underline` + `group-hover:text-accent`),
  not blue web links — and as navigation they owe the **Interactive affordances**
  obligations, notably a `focus-visible` ring for keyboard readers. (A resting
  underline on every headline can read heavy in a dense digest; see that section
  for when layout, not a permanent rule, may carry the resting cue.)

## Interactive affordances: making controls *look* clickable

This section is the "does it look clickable in the first place" half of
interaction; **Asynchronous activity** below is the complementary "what happens
*after* you click" half. Both stay in newsprint voice.

A modern interactive newspaper (rule #3) has a standing problem a printout
doesn't: a reader must be able to tell, *without touching anything*, which marks
on the page are controls. The failure mode is styling a control as plain
metadata — small-caps muted text pixel-identical to a dateline, with no resting
affordance, nothing saying "button" until you hover. The convention closes that
gap: every actionable or navigational element carries a **resting** signal, plus
matching `hover` **and** `focus-visible` states, all expressed with the existing
tokens.

### The four obligations of any control

Every link, button, or toggle must satisfy all four. They're cheap — a handful of
existing utilities — and non-negotiable for accessibility.

1. **Resting affordance.** The control looks interactive *before* any pointer
   touches it. In this system that's a **ruled treatment**: an underline (text
   links / nav), a drawn border or filled ink block (action buttons), or the
   ruled square (binary toggles). Never rely on hover alone to reveal that
   something is a control — a touch device has no hover, and a sighted reader
   shouldn't have to sweep the page to find the affordances.
2. **`hover` state.** A pointer over the control shifts it — typically the
   sparse **accent** ink (`hover:text-accent`) for text/links, or a darker ink
   fill (`hover:bg-ink-soft`) for solid buttons. This is the accent's main job;
   keep it to *interaction*, never decoration, so it stays loud by staying rare.
3. **`focus-visible` state — keyboard a11y, non-negotiable.** Every control MUST
   show a clear focus ring when reached by keyboard, via the `focus-visible:`
   variant (not bare `focus:`, which also fires on mouse click and is noisy).
   Use the existing ink tokens — `focus-visible:outline-2
   focus-visible:outline-offset-2 focus-visible:outline-ink` — so it reads as a
   drawn rule, not a browser-default blue glow. A control with hover but no
   visible focus is **broken for keyboard users**; it's the obligation most
   easily forgotten, so check it explicitly.
4. **`cursor-pointer`.** The pointer becomes a hand over the control. Native
   `<a href>` does this for free; a `<button>` does **not** in Tailwind's reset,
   so add `cursor-pointer` to every button/toggle.

### The three idioms

Distinguish three kinds of control, each with its own on-brand resting signal.
Pick by *what the control does*, not by what tag is convenient.

- **Text links (navigation).** Going somewhere — a headline, an "Already have an
  account? Sign in" link. Resting signal: a **hairline underline** in body ink,
  going **accent on hover** — `underline underline-offset-2 hover:text-accent`,
  plus the focus ring. Not blue, not bold-as-link. Headlines are the one place a
  *resting* underline can feel heavy on a dense digest; there it's fine to reserve
  the underline for `hover`/`focus-visible` and let layout carry the resting cue
  (the row is a single tap target, the link is the row's only serif headline). The
  bar stays "a reader can tell the headline is a link," just met by layout rather
  than a permanent rule.
- **Action buttons (do something here).** Triggering an action that isn't pure
  navigation — Sign out, Create account, Sign in. Resting signal: a **drawn
  control** — either a solid ink block (`border border-ink bg-ink text-paper`,
  the primary submit) or a ruled outline (`border border-ink`, a secondary
  action). Hover darkens the fill (`hover:bg-ink-soft`); focus draws the ring;
  `cursor-pointer` always. A sign-out / session control is an *action button*,
  **never** bare metadata text.
- **Binary-state controls (toggle).** Flipping one piece of state in place — the
  read/unread square. Resting signal: the **ruled square** idiom — empty
  `border-rule` for the off state, filled `border-ink bg-ink` with a `✓` for on.
  Hover firms the border (`hover:border-ink`); focus draws the ring;
  `cursor-pointer`. Reuse this square for any future binary state; don't reach
  for a colored pill or an iOS-style switch.

### Do / don't, in tokens

```
✅  text link        <a class="underline underline-offset-2 hover:text-accent
                              focus-visible:outline-2 focus-visible:outline-offset-2
                              focus-visible:outline-ink" href="…">Sign in</a>

✅  action button    <button class="cursor-pointer border border-ink bg-ink py-2
                              font-sans text-sm uppercase tracking-[0.2em] text-paper
                              hover:bg-ink-soft focus-visible:outline-2
                              focus-visible:outline-offset-2 focus-visible:outline-ink">
                       Sign out
                     </button>

✅  binary toggle    <button class="cursor-pointer grid size-4 place-items-center
                              border border-rule hover:border-ink focus-visible:outline-2
                              focus-visible:outline-offset-2 focus-visible:outline-ink">…</button>

❌  control as metadata   <button class="font-sans text-[0.65rem] uppercase
                              tracking-[0.2em] text-muted hover:text-accent">Sign out</button>
        — no resting affordance, no focus ring, no cursor; identical to a dateline
          until hovered. This is the anti-pattern.

❌  hover-only reveal      relying on group-hover/hover to first announce a control
        — invisible on touch, undiscoverable by scanning, broken for keyboard.

❌  bare focus:            focus:outline-… without -visible fires on mouse click too;
          use focus-visible: so the ring is a keyboard cue, not click noise.

❌  SaaS dressing          rounded-full pills, drop shadows, gradients, a bright
          always-on accent fill. The accent appears on interaction and stays rare.
```

A control at rest is ink and rules; the accent (the **interaction** color and
alert key, never a resting decoration) arrives when the reader engages it. That
restraint keeps the page reading as newsprint even as it announces every control.

## Asynchronous activity: loading, disabling, and feedback

Any time the UI starts work the reader has to wait on — a form submit, an
in-flight request — it must say so, in voice. Silence reads as "broken": no
spinner, no disabled button, no error makes the UI feel unusable. Three
obligations, layered so the no-JS contract still holds.

**Progressive enhancement is the rule.** Every form works with JavaScript off:
the server validates and a full-page POST → 303 → reload is the source of truth
(as the auth forms and the read/unread toggle already are). Loading states,
disabled controls, and inline in-flight errors are *enhancements layered on top*
when JS is present, never a prerequisite. Build the no-JS version first, then
enhance it.

1. **Loading state on every wait.**
   - A full-page POST navigation already gets the browser's native page-loading
     indicator, but the **triggering control** must still show in-flight state
     once JS is on: the button goes busy (`aria-busy`, label swaps to a
     present-tense "Creating account…" / "Signing in…", reduced `opacity`) so
     the reader sees the click registered.
   - An **in-page** async request (one that does *not* navigate) **must** render
     an explicit in-voice loading affordance where the result will appear — an
     italic agate "Working…" line, not a SaaS spinner.
   - Avoid flicker: it's fine to delay a *visible* loading indicator ~150 ms so
     instant responses don't flash one, but disable the control immediately on
     activation.

2. **Disable controls + idempotent writes — double-submit defense, both layers.**
   - On submit, disable the triggering control (and any input that would change
     the request) so a second click can't fire a duplicate (the JS layer).
   - **And** make the write safe to repeat server-side, so a double-POST with JS
     off is still harmless — lean on a `UNIQUE` constraint / idempotent endpoint
     rather than trusting the client (the server layer). Neither layer alone is
     enough.

3. **Surface errors, warnings, and completion — inline, at the point of action.**
   - Errors render **next to the field or control that caused them**, in the
     existing ruled `role="alert"` voice (`border-l-2 border-accent
     bg-paper-edge`; see `AuthForm.astro`). A page-level failure also gets a
     short summary at the top of the affected region. **No toasts or floating
     popovers** — un-newspapery and easy to miss.
   - Distinguish **validation** errors the reader can fix ("Password must be at
     least 8 characters.") from **system/network** errors they can't ("Couldn't
     reach the server. Try again."). Never let an async failure pass silently —
     a swallowed error is the worst outcome.
   - Confirm **completion** of anything the reader waited on. A redirect to a
     visibly-changed page is confirmation enough when there is one (signup → the
     unlocked homepage); an in-page action that leaves the reader on the same
     screen needs an explicit in-voice acknowledgement.

Keep all of it in the newspaper aesthetic — ruled lines, small-caps agate, the
accent red reserved for the alert key — never a colored spinner, progress pill,
or drop-shadowed toast. The accent stays loud by staying rare.

## Motion & animation

Paper is static. Motion is the earned exception, not the default — the same
restraint that governs the accent red governs movement. The bar before animating
anything: "would this look at home in print *coming to life*?", not "can I make
this feel app-y?".

- **When — functional only, and rare.** Animate exactly three things: a **state
  transition** (a row settling into read, a control toggling), **feedback
  acknowledgement** (a busy control, a saved confirmation), and **loading
  affordances** (an in-flight "Working…" easing in). Nothing else. No decorative
  parallax, no entrance flourishes on page load, no attention-grabbing pulse,
  bounce, or shimmer. If the motion isn't *telling the reader something changed*,
  cut it.
- **Kind / duration / easing — subtle and fast.** ~150–200 ms, `ease-out`
  (decelerate into rest). Animate `opacity` and small `transform`s; avoid
  animating layout (width/height/top) — both janky and loud. Nothing bouncy,
  springy, or playful — no `cubic-bezier` overshoot, no `@keyframes` spin. A quiet
  fade, not a performance; instant responses shouldn't flash motion at all.
- **CSS first, JS only as last resort.** Express motion with CSS
  `transition`/`@keyframes` so it degrades as gracefully as the rest of the page.
  Reach for JS only when CSS genuinely can't express it (e.g. FLIP-measuring a
  reorder), and never make an animation a prerequisite for the action: the no-JS
  POST → 303 → reload path stays the source of truth.
- **Libraries — none.** No Framer Motion, no GSAP, no animation dependency,
  mirroring the system-fonts/no-dependency stance. Don't adopt Astro's **View
  Transitions API** (`<ClientRouter />`) either: it turns full-page POST → 303
  reloads into client-side swaps, complicating the no-JS contract above, and its
  default cross-fade reads as app-chrome, not newsprint — and the one-page digest
  doesn't need cross-page transitions. If a multi-page reading flow ever makes it
  worth revisiting, file an issue and scope it to a deliberate,
  reduced-motion-respecting fade, not the library's defaults.
- **Reduced motion is non-negotiable.** Every animation MUST honor
  `prefers-reduced-motion: reduce` with an instant, no-motion fallback. The idiom:

  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
  ```

  A global guard like this in `@layer base` covers the whole app; an individual
  effect can also gate itself (`motion-safe:`/`motion-reduce:` Tailwind variants).
  Either way the reduced-motion reader sees the *end state immediately* — same
  information, no movement.

## Coverage gotcha

`src/**` is under a 100% statements/branches/functions/lines coverage gate. `.astro` components and
`src/lib/**` count. Keep presentational helpers branch-free (see
`src/lib/format.ts` — fixed name tables, no conditionals) and make sure any new
component is actually rendered by a test, or the gate fails.

## Screenshots for visual changes

This skill governs look-and-feel by review, and a visual change is reviewed by
eye — so the review has to *see* it. **Any PR that changes what a page or
component looks like ships before/after screenshots in the PR body.** A unit
test asserting markup is not a substitute; a reviewer can't tell from a diff
whether the read square sits right or the dateline reads as agate.

**Capture against the running app**, not a fixture render. In the agent
container, drive the dev server with the baked headless Chromium (the
`agentic-environments` skill has the container/dev-server specifics — host-port
mapping, the baked browser path, where `$DEV_HOST_4321` comes from). Concretely:

- Start the dev server on workerd and bind all interfaces:
  `npm run dev -- --host`, then point the browser at `http://$DEV_HOST_4321/`
  (the in-container `localhost:4321` maps to a different, randomized host port —
  see `agentic-environments`).
- Launch Chromium with `chromium.launch({ args: ['--no-sandbox'] })` — non-root
  Chromium in the container can't use the sandbox (throwaway container, so it's
  fine). The baked browser lives at `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`.
- Seed a little local D1 so the feed isn't empty, and sign in so authenticated
  states (read/unread, the visited tag) actually render — capture the *states
  that matter* to the change, not just one happy shot.
- Save before/after PNGs.

**Attach by uploading the PNGs to R2**, not by committing them to git. Binaries
must not accumulate in `main`'s history. Use the helper:

```
scripts/upload-screenshot.sh <issue-number> before docs/screenshot-before.png
scripts/upload-screenshot.sh <issue-number> after  docs/screenshot-after.png
```

It puts each PNG to the public `news-cdn` R2 bucket (`--remote`) under the
`pr-screenshots/<issue>/` prefix and prints the public URL. Embed those URLs in
the PR body so GitHub renders them inline:

```markdown
**Before**

![before](https://news-cdn.cuteteal.com/pr-screenshots/<issue>/before.png)

**After**

![after](https://news-cdn.cuteteal.com/pr-screenshots/<issue>/after.png)
```

Why this works: `news-cdn` is a public R2 bucket (the `CDN` binding in
`wrangler.jsonc`) served at `news-cdn.cuteteal.com` via R2's native custom domain
— CDN-cached, free egress, no Worker in the request path. The URL is public, so
GitHub's image proxy (which fetches unauthenticated) renders it inline and the
evidence persists on merged PRs. If the helper errors on auth or the URL doesn't
resolve, its header documents the one-time activation (token R2 scope + the
`wrangler r2 bucket domain add news-cdn news-cdn.cuteteal.com` step).
