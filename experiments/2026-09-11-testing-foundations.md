# Testing foundations verification — 2026-09-11

## Changes

- TI listing dates (`DD Mon YYYY`) become UTC midnight; timezone-bearing values
  retain their meaning. Regression examples cover Chicago's March and November
  daylight-saving boundaries, surrounding whitespace, missing/invalid dates,
  and explicit offsets.
- Browser invocations own a random loopback port and `.playwright/run-*` root.
  The root contains D1/KV/R2 persistence, build output, generated Astro files,
  preview metadata and test-only runtime variables. Build and preview run with
  that directory as their working directory too: Astro's CLI writes
  `.astro/preview.json` relative to cwd independently of `config.root`.
- Tests import the automatic fixture, which clears sessions and deletes read
  history, users, items and feed state before every case. Resets use one reused
  local binding proxy and one D1 batch. Separate runs retain distinct reports
  and traces; their temporary runtime roots are removed afterward.
- One `WORKER_TESTS` list classifies runtime-bound tests. Node discovers the
  other specs automatically. One source-to-spec map generates Stryker's test
  list and is checked against real files and the mutation source list.
- Mutation scores remain advisory. Runner errors fail the workflow; missing,
  malformed, unfinished and unmeasured reports fail score extraction. A genuine
  0% score still exits successfully.

## Reproduce

```sh
npm test
TZ=UTC npm test
TZ=America/Chicago npm test
npm run test:e2e -- state-isolation.spec.ts
node experiments/verify-e2e-isolation.mjs
npm run test:mutation
node scripts/mutation-score.mjs
```

The isolation experiment runs the entire browser suite concurrently with the
signup spec, both in CI mode. It fingerprints development files before/after,
checks separate JSON reports, and checks that both temporary roots disappear.
Its logs remain in `.playwright/isolation-evidence/` (ignored).

## Observed evidence

- `npm test`: 828 tests across 63 files, 100% statements, branches, functions
  and lines. UTC and America/Chicago both pass; no timezone override is needed
  for the normal command.
- Strict concurrent audit: all 27 browser cases passed alongside a separate
  three-case signup run. All 68 development files remained byte-for-byte
  unchanged, including the development D1, `.dev.vars`, `dist`, `.astro`, and
  Wrangler's deployment redirect. Each run retained its own report and removed
  its temporary runtime root.
- The new reset regression fails with the old `DELETE FROM users` behavior:
  the reused ID inherits a prior `item_reads` row. With the fix, history is empty
  and the old browser's session cookie cannot authenticate as the new account.
- Isolation exposed two existing test dependencies. The pinned-position case
  now seeds its own article; the scroll-preservation case measures a chosen
  deep row's current position instead of assuming that row is at a fixed y
  coordinate. Both pass independently and in the full suite.
- The existing development servers on port 4321 retained the same process IDs.
  Deliberately targeting that occupied port failed before migrations/test state
  setup; the normal launcher chooses a free port.
- Tailwind source discovery is explicitly rooted in `src`, so an isolated Astro
  root compiles the same application utilities (including 44px read targets).
- Simultaneous builds initially raced on Cloudflare's default inspector port;
  the test-only adapter now disables that unused inspector.
- A complete Stryker run succeeded at 91.13%. A deliberately malformed Stryker
  config returned exit 1. Report-validator examples verify a measured 0% score
  succeeds and missing/invalid/incomplete inputs fail.
