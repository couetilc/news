---
name: testing
description: Place tests in the correct runtime, verify parser and browser behavior, and maintain this repo's coverage and mutation configuration.
---

# Testing

The [central policy](../../../CLAUDE.md#tests-and-review) requires `npm test`
before commits: 100% Istanbul statements, branches, functions and lines over
`src/**`. Coverage proves execution, not correctness. Assert exact observable
results and boundaries; preserve count, ordering and duplicate guarantees.
Do not remove useful runtime guards to avoid covering a branch. TypeScript
non-null assertions do not validate values at runtime.

## Runtime placement

- **workers:** real D1/KV, `cloudflare:workers`, `cloudflare:test`, workerd
  crypto and orchestration. Add runtime-bound specs to the shared `WORKER_TESTS`
  in `test/runtime.ts`; `vitest.workers.config.ts` includes that list.
- **node:** pure parsers/core logic, `.astro` Container API renders and browser
  DOM modules. `vitest.node.config.ts` discovers `test/**/*.test.ts` automatically
  and excludes `WORKER_TESTS`. No second include list needs updating.
- Both projects set `configFile: false`. The Node render config registers its
  Astro/Tailwind plugins explicitly and aliases `cloudflare:workers` to the
  test helper. Keep relevant changes in sync with the real Astro build.
- Browser DOM specs live in `test/browser/` and use a first-line `// @vitest-environment happy-dom`.
  Exercise delegated events and `astro:page-load` wiring where relevant;
  exported initializers are valid focused test seams.

Tests in `npm test` never call the network. Inject `fetchFn` and use captured,
sanitized `test/fixtures/` payloads. Separate live endpoint probes from tests.
Real D1 tests prove SQL ordering, constraints and conflict behavior; do not
replace them with mocks or duplicate SQL algorithms only for coverage.

## Type checking

Run `npm run typecheck` before delivery. The required CI `test` job runs it.
`astro check` covers templates, source TypeScript, Node/component tests and e2e
TypeScript/configs. `tsconfig.worker.json` additionally checks `src/lib/**` and `src/ingest/**`
against runtime-only Wrangler types without browser DOM; `tsconfig.browser.json`
checks `src/scripts/**` and `test/browser/**` against DOM without Worker globals.
The split prevents Cloudflare HTMLRewriter's `Element` from contaminating DOM
unit tests. Astro entry points remain in the framework check because Astro
itself references DOM declarations. Runtime-only types are generated under
`.astro/` by the typecheck command, from the same Wrangler config. Every authored
source TypeScript file remains checked. Do not fix
runtime conflicts by excluding source, adding broad `any` or `@ts-nocheck`.

## Choosing checks

Use focused example tests for logic and regressions. New browser interactions
need end-to-end coverage of the primary path and important integration edge
(navigation, middleware, cookies, router swaps, forms or scrolling). Reuse an
existing e2e case when it already proves a small change; copy-only and factual
documentation edits do not need fabricated browser specs. For bug regressions,
verify the case fails for the actual bug when practical, then passes with the
fix. Keep broad input permutations in fast unit tests.

Run `npm run test:e2e -- [spec/options]`, not bare `playwright test`. The launcher
creates an owned loopback port and `.playwright/run-*` build/state root, then
cleans it up. It leaves `.dev.vars`, development D1/KV, `dist` and other dev
servers untouched. Import `test`/`expect` from `e2e/fixtures.ts`; its automatic
fixture resets state before each case. Seed in `beforeEach`, not `beforeAll`.
Tests are serial within one run; separate invocations have isolated resources.
Use native pinned Chromium; container/cloud exceptions are in the environment
skill. Do not claim browser validation when only markup was rendered.

## Untrusted parser contract

A parser either returns well-formed `ParsedItem[]` or throws its documented
source-format guard, never a raw `TypeError`, `SyntaxError` or hang. Test real
listing/feed shapes, malformed/truncated input, wrong top-level types, invalid
links and missing fields. Keep scans bounded; do not evaluate embedded scripts.

Independent `countRaw` plus `validateParse` makes silent shape drift visible.
Responsive duplicates can remain until D1 dedupe, provided the raw/parsed
counts have consistent meaning. Keep filters must not silently discard every
new article after a required date/field changes. Check the actual published
source in addition to a reduced fixture, and confirm its production poll.

For property/fuzz tests, use deterministic seeds and meaningful invariants.
Pair them with exact examples; pin shrunk failures as regressions. Draw from
small key pools when deduplication needs collisions. Avoid properties that
succeed regardless of whether the implementation is correct.

## Mutation and CI

Both `test` and `e2e` are required PR checks. Mutation is advisory; runner/report
failures matter, while surviving mutants alone do not block merge. Scheduled
heavy checks are separate from deployment and do not start agent watchers.

When adding a pure `src/lib/**` or `src/ingest/**` module, update `mutate` in
`stryker.config.json` and its source-to-spec mapping in `test/mutation-scope.ts`.
`vitest.stryker.config.ts` derives the test list; `test/stryker-scope.test.ts`
checks classification. Runtime glue stays in the documented glue allowlist;
prefer a dedicated pure test to expanding the untested-core exception list.

Read [mutation and CI details](references/mutation-and-ci.md) when changing
those configs or auditing a heavy run. Follow
[Authorization](../../../CLAUDE.md#authorization) for any proposed change to
standing checks or new dependency/trust choices.
