---
name: Testing
description: How this repo tests — the two vitest projects (workers/node) and why, the 100% Istanbul coverage gate over src/**, the hermetic no-network rule and test/fixtures/, when to reach for a unit vs property vs fuzz vs e2e test, the "assert behavior, never just cover" principle with concrete good/bad examples, contracts and the branch-gate caveat, and where mutation/property/fuzz testing fit.
when_to_use: Writing or reviewing any test; deciding which kind of test a change needs (unit / property / fuzz / e2e); a test passes coverage but you're unsure it asserts anything; adding a new src/** file and wiring its test into the right project; touching vitest.*.config.ts, test/**, or test/fixtures/; an assert/throw on an "impossible" path fights the 100% branch gate; questions about mutation testing, property testing, or fuzzing the ingest parsers.
---

# Testing

How https://news.cuteteal.com is tested. Read this before writing or reviewing a
test so the suite stays **well-tested, not just well-covered**. The 100% coverage
gate is the floor; this skill is how we make tests actually *prove* behavior on
top of it.

## The one principle: assert behavior, never just cover

Coverage proves a line *executed*. It does **not** prove a test *checked the
result*. A test that calls a function and asserts nothing meaningful turns the
100% gate green while catching no bug — the exact failure mode this repo guards
against. Every test must assert the **observable behavior**, not merely run the
code.

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

Tells you a test is cover-without-assert: it asserts only `toBeDefined`/
`not.toThrow`/`toBeTruthy` on a value with a knowable exact shape; it snapshots
output without ever reading a field; it exercises a branch but checks a value
that's identical on both sides of the branch (so the branch could be inverted
and the test still passes — mutation testing finds exactly these; see below).

**Assert the edges, not just the happy path.** Most shipped bugs live at a
boundary that a "covered" test walked straight past — empty input, the off-by-one
page, the `null` array element, the malformed feed. `parsePage`/`clampPage` are
all-boundary functions; their tests enumerate the boundaries on purpose.

## The two vitest projects (and why two)

`npm test` runs `vitest run --coverage` over **two projects**, wired together in
`vitest.config.ts` which owns the merged coverage gate. Two runtimes are
genuinely required — this is not gratuitous:

- **`workers`** (`vitest.workers.config.ts`) — runs **inside workerd** via
  `@cloudflare/vitest-pool-workers`. Use it for anything that needs the real
  runtime: `cloudflare:workers` env, **D1 bindings**, and `ON CONFLICT` dedupe
  semantics behave exactly as in production. A real local D1 (`NEWS_DB`) is
  declared inline (`miniflare.d1Databases`) and the committed `migrations/*.sql`
  are applied per test file by `test/helpers/apply-migrations.ts` (the
  `applyD1Migrations` helper from `cloudflare:test`). **All `src/ingest/**` and
  the worker's real D1 behavior live here.**
- **`node`** (`vitest.node.config.ts`) — plain node environment, for the two
  things the worker pool can't host: rendering `.astro` pages through Astro's
  **Container API** (Astro's Vite plugins pull in `xxhash-wasm`, which the worker
  pool can't load), and the trivial **`src/worker.ts`** entry test (its
  workerd-specific imports are `vi.mock`ed; running it under node keeps
  Istanbul's coverage of the async `scheduled` handler deterministic — under the
  worker pool that coverage dropped at random and red-failed the gate, #37).

Both configs keep `configFile: false` (the Cloudflare adapter's Vite plugin is
incompatible with the test pipeline). Pages import `cloudflare:workers`, aliased
in the node project to `test/helpers/cloudflare-workers.ts`; a page's data access
is mocked there and its **real** D1 behavior is covered by the `workers` project.

**Which project does my new file go in?** Touches D1 / `cloudflare:workers` / an
ingest parser → `workers`. Renders a `.astro` page or is `worker.ts` → `node`
(and add the filename to the `include`/`exclude` lists in *both* configs — the
node project explicitly lists its files; the workers project excludes them).
Every `src/**` file must be exercised by exactly one project or the gate fails.

## The coverage gate

**Istanbul, 100% statements / branches / functions / lines over `src/**`**,
merged across both projects (`vitest.config.ts` → `coverage.thresholds`). The
suite fails below 100% on any of the four — this is the standing floor and it
stays.

- **Istanbul, not V8**, because workerd has no `node:inspector`. Istanbul's four
  metrics are therefore the ceiling for execution coverage here — condition /
  MC-DC / path coverage aren't available in any mainstream JS tool and are
  overkill for a single-user aggregator anyway (see #75 for the full survey).
- **Branch is the strongest of the four.** All four already sit at 100%; the gate
  enforces what we hold so a regression can't slip in.

### Coverage gotcha — the branch gate punishes defensive conditionals

A 100% **branch** gate means an `if`/`?:`/`??`/`&&` whose "impossible" side is
never hit by a test is an **uncovered branch that fails the build**. This shapes
how `src/**` is written, and you must respect it:

- `src/lib/format.ts` is deliberately **branch-free** — fixed name tables indexed
  by UTC fields, no conditionals — so date formatting needs no branch coverage.
- `src/lib/users.ts` uses `return row!` (a non-null assertion) instead of
  `if (!row) throw …` after a `RETURNING` insert: the runtime check would add a
  branch the happy path can never exercise. The assertion documents the invariant
  *without* a branch.
- The same trap applies to presentational `.astro` helpers (see the
  `design-system` "Coverage gotcha"): keep them branch-free or ensure a test
  renders every branch.

The lesson for **contracts** (design-by-contract `assert`/throw on "this can't
happen" paths): a runtime guard on an impossible path **adds an uncovered branch
and breaks the gate.** So contracts pay off only where the guarded condition is
*reachable and worth a test* (then assert it — it's real behavior); where it's
genuinely impossible, prefer a type-level guarantee (a non-null assertion, an
exhaustive `switch` on a union, a branch-free table) over a runtime check. Don't
add an `assert` you then have to write a contrived test to cover — that's the
gate fighting you, and the type system is the better tool.

## The hermetic, no-network rule

**Tests in `npm test` must never hit the network.** This keeps the suite
deterministic and green in CI, in claude.ai cloud sessions (Trusted network
mode), and offline.

- The ingest runner takes an **injected `fetchFn`** — tests pass a fake, never
  real `fetch`. Parsers are pure string→`ParsedItem[]` functions; feed them
  fixtures.
- Real feed/API payloads live under **`test/fixtures/`** (`*.xml` for RSS/Atom,
  `*.json` for the JSON APIs — AWS, SEC EDGAR, TI). Add a fixture rather than
  inlining a multi-KB feed, or build a tiny inline document with a `wrap()`
  helper for edge cases (see `parse-rss20.test.ts`'s edge-case block).
- If a change makes a test *want* the network, that's the signal to inject a seam
  instead. (A vetted mocking lib like `msw` is a possible future dev-dep, but it
  goes through the `dependencies` skill's propose→approve gate — don't add it
  unilaterally.)

## When to reach for which kind of test

| Kind | Use it for | Where it runs | Cost |
|---|---|---|---|
| **Unit / example** (default) | A specific input→output, a named edge case, a D1 query's effect, an SSR render | `npm test` (workers or node) | cheap — always |
| **Property-based** | A pure function with an **invariant** that should hold over *all* inputs (idempotence, clamp bounds, roundtrip, "always returns N items") | `npm test` (cheap; should become a first-class default — see below) | cheap |
| **Fuzz** | A function parsing **untrusted external input** — "never throws undocumented / never hangs / always returns a well-formed shape" | `npm test` for the in-suite form; heavyweight coverage-guided fuzzing out-of-band | cheap in-suite |
| **e2e (Playwright)** | Real-browser / full-stack behavior the hermetic pools *can't* exercise: JS-driven UI, multi-page flows, real HTTP redirects/cookies, the read/unread animation | `npm run test:e2e` — **separate** entry, outside `npm test` and the coverage gate | slow, flakier — keep sparse |

Decision order: **default to a unit test.** Reach for a **property** test when you
can state an invariant ("for all valid pages, `offsetFor(p)` is a non-negative
multiple of `PAGE_SIZE`") — it explores inputs your examples won't. Reach for
**fuzz** when the input is hostile/external (the parsers). Reach for **e2e** only
when the behavior literally requires a browser or the full request/redirect/
cookie cycle — vitest stays the default for logic and SSR render. e2e is for
behavior, not coverage: it does **not** count toward the 100% `src/**` gate (#77
tracks the CI wiring + fuller guidance; #46 baked in the browser).

### Property-based testing — the cheap, high-value default

For pure modules with clear invariants, a property test beats a handful of
examples because fast-check *generates* the inputs (and shrinks any failure to a
minimal counterexample). Candidates already in the tree:

- `pagination.ts`: `clampPage(p, total)` ∈ `[1, totalPages(total)]`; `offsetFor`
  is a non-negative multiple of `PAGE_SIZE`; `parsePage` returns an integer ≥ 1
  for **any** string.
- `auth.ts`: `normalizeEmail` idempotence (`normalize(normalize(x)) ===
  normalize(x)`); `verifyPassword(pw, hashPassword(pw))` roundtrips to `true`.
- parsers: a well-formed generated feed → a stable `ParsedItem[]` shape.

Property tests run inside the normal hermetic vitest suite — no new runtime, no
network. (fast-check itself is a proposed dev-dependency, gated through the
`dependencies` skill — see the testing-strategy follow-ups; until it lands,
hand-rolled boundary enumeration is the fallback.)

### Fuzzing the ingest parsers — robustness, not coverage

`src/ingest/parse/**` (atom, rss20, aws-whats-new, sec-edgar, ti-newsroom) parse
**untrusted external XML/JSON**. Malformed / truncated / `null` / adversarial
input is the real-world failure mode — a parser that throws an *undocumented*
error or hangs breaks ingestion in the Worker. The fuzz contract for each parser:

> Given arbitrary input, it may throw **only** its documented `"not a … feed"`
> guard; it must never throw a `TypeError`/`RangeError`/`SyntaxError`, never
> hang, and always return a well-formed `ParsedItem[]` (every field the right
> type).

A **differential** variant fits when two code paths must agree on the same input
(e.g. when one parser is refactored or consolidated, fuzz old-vs-new and assert
they produce identical items — this is how you'd validate a change like the #71
SEC-parser consolidation). Fuzzing is offline by construction, so it respects the
hermetic rule.

## Mutation testing — does the suite actually *assert*?

Mutation testing (Stryker) injects faults into `src/**` (`>` → `>=`, `&&` → `||`,
delete a statement) and checks whether the suite **fails** ("kills the mutant").
A **surviving** mutant is a line that's covered but not meaningfully asserted —
the direct, automated answer to "100% coverage, bug still shipped." It's the
metric for *test efficacy*, the axis coverage can't see.

It's **heavyweight** (runs the suite many times), so it's an **advisory /
periodic** tool, never a per-commit gate — the per-commit gate stays the fast,
hermetic `npm test`. Cadence and adoption are human-gated and tracked in the
testing-strategy follow-ups (incremental per-PR on changed files; full sweep
nightly; advisory → threshold once stable).

When you write a test, you can pre-empt surviving mutants by asking: *if I
inverted this comparison or returned a constant, would any assertion catch it?*
If not, your assertion is too weak — tighten it to a value that differs across
the boundary.

## Quick checklist before you commit a test

1. `npm test` green at **100%** (all four metrics) — must pass before any commit.
2. Every test **asserts an exact, observable result** — no `toBeDefined`-only,
   no snapshot-without-reading-a-field.
3. **Boundaries covered**: empty, zero, the off-by-one, `null`, malformed input.
4. New `src/**` file wired into the **right project** (workers vs node), and into
   *both* config lists if it's a node-project file.
5. **No network** — fixtures under `test/fixtures/` or an injected `fetchFn`.
6. A new conditional didn't add an **uncovered "impossible" branch** (prefer a
   type-level guarantee over a runtime guard you can't reach).

## Cross-references

- Project `CLAUDE.md` "Testing policy" — the load-bearing summary + the pointer
  here. This skill is the detail; keep them in sync, no duplication.
- `design-system` skill "Coverage gotcha" — the `.astro`/branch-free guidance for
  presentational code.
- `dependencies` skill — adding a test-tooling dep (fast-check, Stryker, msw) goes
  through the propose→approve gate; don't add one unilaterally.
- Issues **#75** (the four-metric coverage gate + metrics survey), **#77**
  (Playwright e2e CI + when-to-write), **#46** (browser baked into the container),
  **#98** (this umbrella: the strategy + adoption follow-ups, human-approved).
