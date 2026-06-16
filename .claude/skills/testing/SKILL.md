---
name: Testing
description: How this repo tests — the two vitest projects (workers/node) and which your test belongs in, the 100% Istanbul coverage gate over src/** and its branch-gate gotcha, the hermetic no-network rule and test/fixtures/, when a change needs a unit vs an e2e test, the robustness contract for parsers of untrusted input, and the "assert behavior, never just cover" principle with good/bad examples.
when_to_use: Writing or reviewing any test; deciding whether a change needs a unit or an e2e test; a test passes coverage but you're unsure it asserts anything; adding a new src/** file and wiring its test into the right project; touching vitest.*.config.ts, test/**, or test/fixtures/; a guard on an "impossible" path fights the 100% branch gate; testing a parser of untrusted input.
---

# Testing

How https://news.cuteteal.com is tested. Read this before writing or reviewing a
test. The 100% coverage gate is the floor; this skill is how to make tests
actually *prove* behavior on top of it.

## Assert behavior, never just cover

Coverage proves a line *executed* — not that a test *checked the result*. A test
that calls a function and asserts nothing meaningful turns the gate green while
catching no bug. Every test asserts the **observable behavior**, not merely runs
the code.

```ts
// ❌ BAD — covers parsePage but asserts nothing about the value. 100% green, 0 bugs caught.
it('parses a page', () => {
  parsePage('7');                       // executed → covered
  expect(parsePage('7')).toBeDefined(); // a number is always defined; this is noise
});

// ✅ GOOD — pins the exact contract, including the boundaries that bite.
it('reads a valid 1-based page and rejects junk', () => {
  expect(parsePage('7')).toBe(7);
  expect(parsePage('2x')).toBe(1);  // trailing junk → fallback
  expect(parsePage('0')).toBe(1);   // below floor → fallback
  expect(parsePage(null)).toBe(1);  // missing → fallback
});
```

A test is cover-without-assert if it asserts only `toBeDefined` / `not.toThrow` /
`toBeTruthy` on a value with a knowable exact shape; snapshots output without
ever reading a field; or exercises a branch while checking a value identical on
both sides (invert the branch and the test still passes — that assertion is
worthless). When you write an assertion, ask: *if I inverted this comparison or
returned a constant, would this catch it?* If not, tighten it to a value that
differs across the boundary.

**Assert the edges, not just the happy path.** Most shipped bugs live at a
boundary a "covered" test walked past — empty input, the off-by-one page, the
`null` array element, the malformed feed. `parsePage`/`clampPage` are
all-boundary functions; their tests enumerate the boundaries on purpose.

## The two vitest projects — and which yours belongs in

`npm test` runs `vitest run --coverage` over **two projects**, wired together in
`vitest.config.ts`, which owns the merged coverage gate. Two runtimes are
genuinely required:

- **`workers`** (`vitest.workers.config.ts`) — runs **inside workerd** via
  `@cloudflare/vitest-pool-workers`. Use it for anything needing the real
  runtime: `cloudflare:workers` env, **D1 bindings**, and `ON CONFLICT` dedupe
  semantics behave exactly as in production. A real local D1 (`NEWS_DB`) is
  declared inline (`miniflare.d1Databases`) and the committed `migrations/*.sql`
  are applied per test file by `test/helpers/apply-migrations.ts`
  (`applyD1Migrations` from `cloudflare:test`). **All `src/ingest/**` and the
  worker's real D1 behavior live here.**
- **`node`** (`vitest.node.config.ts`) — plain node environment, for the two
  things the worker pool can't host: rendering `.astro` pages through Astro's
  **Container API** (its Vite plugins pull in `xxhash-wasm`, which the worker
  pool can't load), and the trivial **`src/worker.ts`** entry test. Keep the
  `worker.ts` test here: under node, Istanbul's coverage of its async `scheduled`
  handler is deterministic; under the worker pool that coverage is dropped
  intermittently and red-fails the gate. Its workerd-specific imports are
  `vi.mock`ed.

Both configs keep `configFile: false` (the Cloudflare adapter's Vite plugin is
incompatible with the test pipeline). Pages import `cloudflare:workers`, aliased
in the node project to `test/helpers/cloudflare-workers.ts`; a page's data access
is mocked there, and its **real** D1 behavior is covered by the `workers`
project.

**Which project does my new file go in?** Touches D1 / `cloudflare:workers` / an
ingest parser → `workers`. Renders a `.astro` page or is `worker.ts` → `node`
(and add the filename to the `include`/`exclude` lists in *both* configs — the
node project lists its files explicitly; the workers project excludes them).
Every `src/**` file must be exercised by exactly one project, or the gate fails.

## The coverage gate

**Istanbul, 100% statements / branches / functions / lines over `src/**`**, merged
across both projects (`vitest.config.ts` → `coverage.thresholds`). The suite
fails below 100% on any of the four. Istanbul (not V8) because workerd has no
`node:inspector`; branch is the strongest of the four metrics.

### Coverage gotcha — the branch gate punishes defensive conditionals

A 100% **branch** gate means an `if`/`?:`/`??`/`&&` whose "impossible" side no
test hits is an **uncovered branch that fails the build**. This shapes how
`src/**` is written:

- `src/lib/format.ts` is deliberately **branch-free** — fixed name tables indexed
  by UTC fields, no conditionals — so date formatting needs no branch coverage.
- `src/lib/users.ts` uses `return row!` (a non-null assertion) instead of
  `if (!row) throw …` after a `RETURNING` insert: a runtime check would add a
  branch the happy path can never exercise. The assertion documents the invariant
  *without* a branch.
- The same trap applies to presentational `.astro` helpers (see the
  `design-system` "Coverage gotcha"): keep them branch-free, or ensure a test
  renders every branch.

So for a guard on an "impossible" path: add it only where the condition is
*reachable and worth a test* (then assert it — it's real behavior). Where it's
genuinely impossible, prefer a type-level guarantee (a non-null assertion, an
exhaustive `switch` on a union, a branch-free table) over a runtime check you
then have to write a contrived test to cover.

## The hermetic, no-network rule

**Tests in `npm test` must never hit the network** — so the suite is
deterministic and green in CI, in claude.ai cloud sessions (Trusted network
mode), and offline.

- The ingest runner takes an **injected `fetchFn`** — tests pass a fake, never
  real `fetch`. Parsers are pure `string → ParsedItem[]` functions; feed them
  fixtures.
- Real feed/API payloads live under **`test/fixtures/`** (`*.xml` for RSS/Atom,
  `*.json` for the JSON APIs). Add a fixture rather than inlining a multi-KB feed,
  or build a tiny inline document with a `wrap()` helper for edge cases (see
  `parse-rss20.test.ts`).
- If a change makes a test *want* the network, that's the signal to inject a seam
  instead.

## When a change needs a unit vs an e2e test

**Default to a unit/example test** in `npm test` (workers or node): a specific
input→output, a named edge case, a D1 query's effect, an SSR render. It's cheap,
hermetic, and counts toward the gate.

Reach for an **e2e test** (`npm run test:e2e`, Playwright) **only** when the
behavior literally requires a real browser or the full request/redirect/cookie
cycle — JS-driven UI, multi-page flows, the read/unread animation, a login
round-trip. e2e is a **separate entry point, outside `npm test` and the coverage
gate**; it's slower and flakier, so keep it sparse. Use it for behavior the
hermetic pools *can't* exercise, never as a substitute for a unit test.

## Testing the ingest parsers (untrusted input)

`src/ingest/parse/**` parse **untrusted external XML/JSON**, so malformed /
truncated / `null` / adversarial input is a real failure mode — a parser that
throws an undocumented error or hangs breaks ingestion. The contract each parser
must satisfy, and you must test:

> Given arbitrary input, a parser may throw **only** its documented
> `"not a … feed"` guard — never a raw `TypeError`/`RangeError`/`SyntaxError`,
> never hang — and otherwise returns a well-formed `ParsedItem[]` (every field
> the right type). A garbage payload that is recognizably the wrong document
> surfaces the documented throw (caught per-feed in `run.ts`); element-level junk
> inside an otherwise-valid container is skipped.

Test each parser against its malformed cases (wrong top-level type, truncated
markup, `null`, junk array elements), asserting it either returns a well-formed
array or throws *only* the documented error. A parser returning `[]` from a
non-empty payload is what `src/ingest/validate.ts` flags as an `ingest.anomaly`,
so graceful-empty + that signal is the intended path, not a crash.

## Before you commit a test

1. `npm test` green at **100%** (all four metrics) — must pass before any commit.
2. Every test **asserts an exact, observable result** — no `toBeDefined`-only, no
   snapshot-without-reading-a-field.
3. **Boundaries covered**: empty, zero, the off-by-one, `null`, malformed input.
4. New `src/**` file wired into the **right project** (workers vs node), and into
   *both* config lists if it's a node-project file.
5. **No network** — fixtures under `test/fixtures/` or an injected `fetchFn`.
6. A new conditional didn't add an **uncovered "impossible" branch** (prefer a
   type-level guarantee over an unreachable runtime guard).

## Cross-references

- Project `CLAUDE.md` "Testing policy" — the load-bearing summary + the pointer
  here. This skill is the detail; keep them in sync, no duplication.
- `design-system` skill "Coverage gotcha" — branch-free guidance for
  presentational `.astro` code.
- `dependencies` skill — adding a test-tooling dependency goes through its
  propose→approve gate; don't add one unilaterally.
