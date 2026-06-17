# Auditing scheduled heavy-test runs (mutation / e2e / fuzz)

Read this when `test-runs-needing-review.sh` (or `watch-test-runs.sh`) surfaces a
completed heavy run. The fast `npm test` gate proves coverage, not *efficacy*, and
can't reach production-only behavior; the heavy runs are where test-efficacy gaps
and #123-class production bugs surface — but only if something reads those runs
and routes findings into the backlog. This doc is that framework.

The merged-PR review marks each PR with `agent-reviewed`. Heavy runs can't carry a
label, so the analogue is the **per-kind last-reviewed-run-id marker** the detector
persists (see SKILL.md "Scripts" and the marker section below). Same idea: the
marker is how a reviewed run is told apart from a new one.

## The five steps: baseline → delta → attribute → triage → file

### 1. Baseline → delta, never absolute

Review each heavy run against the **last reviewed run of the same kind**, not in
isolation. The signal is the *change*, not the standing count:

- **mutation** — new *surviving* mutants, or a score drop, vs the prior run.
- **e2e** — new failing or newly-flaky specs vs the prior run.
- **fuzz** — a new counterexample (a generated input the parser now mishandles).

A run reviewed in isolation is mostly noise: a long-standing surviving mutant or a
chronically-skipped spec is not *this window's* finding. Diff the two runs'
machine-readable artifacts and act only on what is new.

The detector seeds the baseline silently on first sight of a kind (a first run has
nothing to diff against) and fires on the *next* run — so by the time a run reaches
you for audit there is always a prior reviewed run to diff against.

### 2. Attribute to the merged PRs in the window

A new finding belongs to the PR(s) merged **between the baseline run and this run** —
the same window the merged-PR review already walks (`merged-prs-needing-review.sh`).
Name the likely-cause PR in the filed issue so an implementer starts from the change
that introduced the gap, not a cold read of the whole module. When the window holds
several PRs, attribute by which one touched the file the new mutant/failure lives in.

### 3. Triage real-vs-noise, per kind

#### Mutation (artifact: `mutation-report` → `reports/mutation/mutation.json`)

The Stryker `json` report lists every mutant under `files[path].mutants[]` with a
`status`, a `mutatorName`, and a `location`. Statuses that matter:

- **`Survived` in changed code → file it.** A covered-but-not-killed mutant is a
  weak or missing assertion: the suite ran the line but nothing pinned its result
  (invert the value and the test still passes). This is a test-quality gap — file a
  **test-scenario issue** per `finding-issue.md`, naming the file+function, the
  mutated expression, and the assertion that would kill it.
  - **But first: is it an *equivalent* mutant?** An equivalent mutant can't change
    observable behavior, so no test can kill it and filing one is noise:
    - a redundant guard (a `?? []` on a value already proven non-null upstream),
    - logging / diagnostics whose output nothing asserts by contract,
    - **registry *data*** like `src/ingest/sources.ts` — mutating a feed URL or a
      label string doesn't change logic the suite is meant to pin (the data is
      validated live, not unit-asserted).
    Equivalent mutants go on the **suppression list** (below) so they don't re-fire;
    only *genuine* gaps get filed.
- **`Timeout` / runtime `RuntimeError` (new) → file it.** A mutation that turns a
  terminating loop into a non-terminating one, or breaks config so the runner errors,
  is a possible infinite-loop or config break worth a real issue — not an equivalent.
- **`NoCoverage` (new) → file it.** A mutant on a line no test exercises at all is a
  straight coverage hole the `npm test` gate somehow didn't catch (e.g. a Stryker
  scope module exercised only by an excluded test) — file as a missing-test gap.
- **`Killed` →** the suite did its job; nothing to file.
- **`CompileError` →** a Stryker/tooling artifact, not a finding.

Score: `mutation.yml` already opens/updates a tracking issue when the *nightly* score
drops below its baseline (currently 85%, `<!-- mutation-regression -->`). Don't file a
duplicate score issue — your job is the **per-mutant delta** (which new mutants
survived, attributed to which PR), which the score number can't express.

#### e2e (artifact: `playwright-report` → `playwright-report/results.json` + `test-results/`)

The Playwright `json` report records each spec's outcome and its retries. The
distinction that drives triage:

- **Real failure** (failed on every attempt, including the `retries: 1` ride-out) and
  the *hermetic* `npm test` suite is green for the same code → this is a bug the
  hermetic pools can't reach: behavior against the **served build** (client router,
  document navigation, real D1, prerender) — a **#123-class production bug**. File a
  **High-severity** issue and attribute it to the window's PR(s).
- **Flaky** (failed then *passed on retry*, or alternates run-over-run with no code
  change) → file as a **flaky** finding (Medium/Low), don't treat it as a blocker.
  Capture the spec name and the trace from `test-results/` so it's reproducible, and
  add it to the **known-flaky suppression list** (below) so the next audit doesn't
  re-file the same flake as new.

#### fuzz (forward-looking — no fuzz workflow exists yet)

No fuzz workflow is wired yet (the detector's `mutation|stryker|e2e|playwright|fuzz`
selector reserves the slug prospectively). When one lands, its artifact must carry the
**minimal counterexample** (the generated input + seed). Triage: a *new* counterexample
— a parser of untrusted input that now crashes (raw `TypeError`/`RangeError`) or hangs,
violating the robustness contract in the `testing` skill — gets filed with that minimal
repro so an implementer can reproduce without the fuzzer. Cite the real artifact name
here once the workflow exists.

### 4. Dedup against the backlog before filing

Before filing, search open issues and read each candidate **in full — body AND
comments** (`gh issue view N --json body,comments`), exactly as the PR-review path
does. If an issue already covers the finding (e.g. the mutation-score regression issue,
or a prior audit's surviving-mutant issue still open), add the run-specific context as a
**comment** rather than a duplicate. The suppression lists below are the *other* half of
dedup: they stop known-equivalent/known-flaky noise from re-presenting as new each run.

### 5. File, then bump the marker

File one `agent-review` issue per genuine new finding (labels and template in
`finding-issue.md`; for a surviving-mutant gap use the **test-scenario** shape). Then
record the run as reviewed:

```bash
test-runs-needing-review.sh --mark <run-id>
```

This is the heavy-run analogue of `gh pr edit --add-label agent-reviewed`. After
marking, run the detector once to confirm it's clean, then re-arm the watch
(SKILL.md "Watch mechanism").

## Suppression lists — where known noise is recorded so it doesn't re-fire

The delta is only meaningful if known-equivalent mutants and known-flaky specs are
suppressed; otherwise every run re-presents them as "new" and the audit drowns.

### Equivalent mutants — inline `// Stryker disable` at the mutant site

`stryker.config.json` has **no per-mutant ignore list** — `mutate` is scope,
`ignorePatterns` is path-level, `ignoreStatic` is unrelated. The right suppression for
a *confirmed-equivalent* mutant is Stryker's native inline directive, placed at the line
it guards, with a reason:

```ts
// Stryker disable next-line all: equivalent — redundant guard, `items` is non-null upstream (audited PR #NNN)
const xs = items ?? [];
```

Why inline rather than a separate in-repo list:

- it lives **at the exact line**, so the next reader sees *why* it's equivalent without
  cross-referencing a list — and a future refactor that makes the mutant non-equivalent
  again moves/removes the comment with the code;
- it's **Stryker-native** (no new tooling, no list to keep in sync with `mutate`);
- the directive is a source diff, so it goes through normal PR review — appropriate,
  since declaring a mutant equivalent is a real judgment call.

Use `disable next-line all` for a single line, or a `// Stryker disable all` /
`// Stryker restore all` pair for a small block. Always include the reason text after
the `:` (the equivalence argument + the audited PR). Do **not** suppress a *genuine*
gap to make the score green — that defeats the tool; file the test-scenario issue
instead.

> Design note for review: an inline-comment suppression keeps the equivalence
> judgment next to the code and inside PR review, with no new file to maintain. If a
> reviewer prefers a single auditable in-repo list instead (e.g. a small
> `mutation-equivalents.md` keyed by file + mutator + location), that's a reasonable
> alternative — flagged here rather than silently chosen.

### Known-flaky e2e — record the spec so the next audit skips it

Playwright already absorbs single-run flakes via `retries: 1` (CI only). For a spec
that's *confirmed flaky over multiple runs* (not a real failure), record it in the
**filed flaky issue** (one issue per flaky spec, labelled `testing`), and keep that
issue open as the durable suppression record: a later audit that sees the same spec
flake again adds a comment to the existing issue rather than filing it as new. If the
flake is loud enough to drown the signal, annotate the spec in `e2e/` (Playwright
`test.fixme(...)` / a `flaky` annotation) so it's visibly quarantined — but a quarantined
spec is a tracked debt, not a fix; the issue stays open until the flake is root-caused.

## Idempotency marker — how the per-kind run id fits

The marker is implemented (`test-runs-needing-review.sh`, via `--mark` into a local
`--state-dir`); this is only how it fits the framework:

- one marker file **per kind** (keyed by a slug of the workflow name — `mutation`,
  `e2e`, future `fuzz` are separate workflows, so per-workflow markers *are* per-kind);
- a run "needs review" iff its `databaseId` exceeds the marker (run ids are monotonic);
- first sight of a kind **seeds** the baseline silently and fires on the *next* run —
  this is what guarantees step 1 always has a prior run to diff against;
- after auditing run `R`, `--mark R` advances the marker — the heavy-run analogue of the
  `agent-reviewed` label. The marker is **local state**, not in-repo, so a fresh
  container re-seeds the baseline once (re-baselining, expected — see `e2e.yml`'s rename
  note), it does not re-file old findings.

The marker is *which run was last audited*; the **suppression lists** are *which
findings within the runs are known noise*. Both are required — the marker stops
re-auditing a run, the suppression lists stop re-filing a finding across runs.
