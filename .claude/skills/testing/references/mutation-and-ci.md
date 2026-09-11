# Mutation and CI details

Stryker measures whether assertions detect faults in pure production logic.
Use `npm run test:mutation`, or `npx stryker run --mutate <path>` for a focused
change. Reports live at `reports/mutation/mutation.json` and `.html`. The
workflow uploads both; `scripts/mutation-score.mjs` reads the JSON score.

- Keep source scope and `test/mutation-scope.ts` mappings aligned. The scope
  guard detects newly unclassified core/glue files; explain genuine exceptions.
- Separate pure decisions from runtime I/O when it improves the code. Do not
  manufacture a parallel JavaScript implementation of SQL just to mutate it.
  Existing `merge.ts` executable semantics are checked against real D1 in
  `db.test.ts`; update both when the dedupe contract changes.
- Survivors may reveal missing assertions or equivalent mutations. Reproduce
  the behavior before adding tests. A `Timeout` counts as detected: broken
  mutant code timing out is not evidence the original app hangs. Check the
  unmutated baseline, runner, artifact and actual changed code first.
- A green unit suite plus failing e2e does not establish production severity.
  Inspect browser traces, seeding, runtime/build differences and flakiness;
  reproduce the user-visible failure and report what is verified.
- Inspect a first failed run without requiring a baseline. When comparing
  runs, name the repo, workflow, event, run IDs and commits. A fetched run is
  not automatically reviewed; report truncated or missing history explicitly.

`ci.yml` owns unit/coverage checks and production deployment. `e2e.yml` owns
required PR browser checks plus scheduled/manual runs. `mutation.yml` owns
path-filtered advisory PR checks and scheduled/manual mutation runs. Keep their
actual job names, permissions and artifacts explicit; no detector naming
convention or permanent watcher is needed.

Scheduled change gates compare inputs to a successful run. Keep the PR path
filter and scheduled input list aligned, including package scripts/lockfile,
configs, relevant source/tests/helpers and the workflow itself. A failed API
lookup must not masquerade as "no change." Preserve machine-readable artifacts
and report runner/report failures. Low mutation scores are report-only under
the standing policy; do not add a blocking threshold without approved scope.
