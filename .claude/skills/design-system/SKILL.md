---
name: design-system
description: Build and review the news app's mobile newspaper UI, source marks, accessible controls, and progressive enhancement.
---

# Newspaper UI

A compact, light newsprint digest: one chronological serif column, warm paper,
near-black ink, hairline rules and small uppercase metadata. Design for phones
first. Wider screens improve spacing/type within the reading column; no CSS
multi-column chronology, decorative card shadows, pill controls or theme switch.

## Source of truth

- `src/styles/global.css` owns Tailwind v4 tokens and component classes; use
  utilities derived from its paper/ink/muted/rule/accent and beat colors.
- `astro.config.mjs` registers `@tailwindcss/vite`; Node page-render tests
  register it independently in `vitest.node.config.ts` (`configFile: false`).
- `src/layouts/Layout.astro` owns masthead and main shell. The chrome is
  `max-w-5xl`; feed controls and articles share a `max-w-2xl` reading column.
- Use system serif fonts for headlines/body and sans for metadata/controls.
  Accent red is sparse interaction/error emphasis, not source identity.

## Existing interactions

- Article rows are ruled and compact. Headlines are the primary links; controls
  occupy their own column and never overlap the headline hit area.
- Read-state controls draw a 16px square inside a real 44px button. Unread is
  hollow; read is filled and the row is muted. The no-JS POST/303 path remains
  functional; enhancement preserves scroll, counts and pagination.
- Owner feeds have URL-addressable Unread/Read tabs and repeatable `?source`
  filters. On mobile a native Sources disclosure keeps articles near the top;
  its summary names the selection, and Clear sources preserves the active tab.
- Swipe left on an owner Unread row to mark it read. Keep vertical pan, pinch
  zoom, cancellation and a real read button. A completed read offers inline
  Undo until the next completed read or navigation; preserve pending Undo
  requests, source tallies and pagination. Swipes do not open headline links.
- Recently viewed is a collapsed, global history of up to three opened items.
  New manual read/swipe actions do not populate or reorder that history. Returning
  one to Unread changes filtered totals only when its source matches. Remove
  the disclosure when it becomes empty.
- On phones, the session control stays in flow above the centered nameplate.
  The dateline links to `/status` with a destination-oriented accessible name.
  It intentionally has no resting underline. Its focus ring is a cue **when
  focused**, not a resting affordance; preserve that approved visual exception
  without claiming it is visibly discoverable at rest. The owner's separate
  Feed health link is visibly underlined.

## Identity marks

Print the full source name beside an `aria-hidden` 10px `.mark` in articles
and the Sources list. The approved compact 24-hour briefing is the exception:
show marks and counts with screen-reader source names, using the full Sources
list as the visible legend. Its rolling publication counts are global and
independent of read state and source filters; exclude unknown/future dates and
keep the counts unchanged during read/Undo actions. No delayed-updates notice.
Rank briefing sources and the front of the Sources list by descending 24-hour
publication count, breaking ties alphabetically. Keep All first in the filter
list and the remaining sources alphabetical.
`src/lib/sources.ts` assigns classes; `test/source-meta.test.ts` checks registry
and CSS consistency. Hue represents the beat, shape a meaningful sub-beat,
fill a source within it, and the name is the exact identity. Preserve existing
assignments. Squares are the default; diamonds identify open-weight AI and
round marks identify specialist model families or specialized AI silicon within
their beat. Quarter/cross fills extend the growing AI desk. New aggregate feeds
use hatch; preserve NVIDIA/Cisco's existing hatch assignments as well.

Hollow identity marks retain the thick 3px border and 4px center at 10px size;
do not confuse them with the thinner read controls. Selected ink-filled chips
use `mark-on-ink` so their marks render in paper color.

## Controls and feedback

Use visible ruled/underlined/filled affordances, hover feedback, keyboard
`focus-visible` outlines and `cursor-pointer` on buttons. Headline layout and
the dateline exception above are the existing exceptions to resting underlines.
Maintain labels, useful hit areas, contrast and keyboard access.

Forms work without JavaScript. With enhancement, disable duplicate submission,
show an appropriate busy state, and surface errors beside the control/field
using the existing ruled `role="alert"` treatment. Server writes still need
idempotence/constraints; disabled buttons alone do not prevent duplicate POSTs.
A visible navigation/state change can acknowledge completion. Avoid toasts,
decorative spinners and swallowed errors.

## Router and motion

`Layout.astro` already mounts Astro's `ClientRouter`. Preserve it. Auth and
session-changing forms use `data-astro-reload` so cookies/redirects use real
browser document navigation. Other client enhancements must survive router
swaps via delegated listeners or `astro:page-load`, without duplicate handlers.
Verify the relevant no-JS and real-browser paths.

Use restrained, functional motion and respect `prefers-reduced-motion`. Astro
handles its transition preference; any custom animation needs its own instant
fallback. Do not claim there is a global CSS guard unless the code provides it.
Avoid introducing an animation library for effects existing CSS can express.

## Visual verification

Inspect changes in the running app with the native browser or isolated e2e
harness, at phone and relevant wider sizes. Check the actual affected state,
including signed-in controls when needed; use local synthetic data and never
publish private production screenshots. Existing browser specs may be reused.
A useful runtime guard is worth testing; coverage is not a reason to delete it.

For PRs changing appearance, attach before/after screenshots of the running app
with comparable data. Upload via `scripts/upload-screenshot.sh <issue> <name>
<path>` and use the exact content-addressed URL it prints; do not commit images
or invent a fixed R2 key. The helper documents configuration. For container or
cloud capture, consult the environment skill only when using that surface.

[CLAUDE.md Authorization](../../../CLAUDE.md#authorization) governs approvals;
this skill does not create a second approval flow.
