---
name: review-merged-prs
description: Detect newly merged GitHub pull requests, perform in-context PR reviews, file actionable findings from open or merged PRs as GitHub issues, and mark each reviewed merged PR with a label. Also audits scheduled heavy-test runs (mutation/e2e/fuzz) against the last reviewed run of the same kind and files findings. Use when asked to watch PR merges, review merged or open PRs, audit a mutation/e2e/fuzz run for new surviving mutants or failures, route findings into the issue backlog, distinguish already-reviewed merged PRs from new ones, or help another agent pick up open review findings. Pairs with issue orchestration.
---

# Review Merged PRs

## Purpose

Watch a GitHub repo for merged PRs, review each merged change in the current
agent context, and route the result into the project's **issue backlog**:
actionable findings become GitHub issues; every reviewed merged PR is tagged
with the `agent-reviewed` label.

The issue-backlog rule also applies to **open PR reviews**. Findings are **not**
written to a committed file and **not** posted as PR comments or PR reviews —
they live as issues, the backlog's single source of truth. If an existing issue
already covers the finding, add the PR-specific context as an issue comment
instead of filing a duplicate. Do not use a PR comment as the finding record.

This skill is shared by both agents: it lives in `.claude/skills/` and is
reached through the `.codex/skills` symlink, so an agent that reads skills from
`.codex/` sees the same definition.

## Labels

- `agent-reviewed` — applied to a merged PR once it has been reviewed (whether or
  not it produced findings). This is how reviewed PRs are told apart from new
  merges.
- `agent-review` — applied to issues filed for actionable findings, alongside the
  normal type/area labels (see the `filing-issues` skill).

## Scripts

Detectors (deterministic delta; exit `0` when nothing changed, `2` when there is
something to review — the wake signal):

- `scripts/merged-prs-needing-review.sh`: list merged PRs that do **not** carry
  the `agent-reviewed` label. The label is the persisted marker, so the delta is
  exactly the unreviewed set.
- `scripts/test-runs-needing-review.sh`: list scheduled heavy-test runs
  (mutation / e2e / fuzz) completed since the **last-reviewed run id of the same
  kind**. The marker is a per-kind file (run ids are monotonic), since a heavy
  run can't carry a label the way a PR can. First sight of a kind seeds the
  baseline silently (nothing to diff against — see #227); it fires on the *next*
  run. After auditing run `R`, bump the marker with `--mark R` (the analogue of
  `gh pr edit --add-label agent-reviewed`). `--json` is read-only inspection.
  Blocked on the heavy workflows existing (#166 mutation, #77 e2e); stays silent
  until they emit runs.

Watchers (the wake mechanism — see "Watch mechanism" below):

- `scripts/poll-detector.sh`: generic loop that runs a detector every `INTERVAL`
  seconds, stays **silent on stdout while idle**, and prints the payload + exits
  `2` the instant the detector reports a delta. Both watchers are thin wrappers
  over it. Set `WATCH_LOG` to capture idle diagnostics off the wake path.
- `scripts/watch-merged-prs.sh`: watch for new merged PRs.
- `scripts/watch-test-runs.sh`: watch for new scheduled heavy-test runs.

Follow-ups:

- `scripts/review-followups.sh`: list open `agent-review` finding-issues so a
  follow-up agent can pick them up.

## Watch mechanism

The scripts are portable; the wake mechanism is not. The detectors and persisted
markers behave the same on Claude, Codex, or a plain shell, but each agent
surface needs its own way to wait for the detector to exit `2`.

### Claude Code

Claude Code can drive the watch **outside the model**, so it is deterministic,
survives across turns/compaction, and costs zero tokens while idle. Use this
path only when the tool surface has `Bash` with `run_in_background` and
`ScheduleWakeup`.

1. **Launch the watcher as a harness background task** — the `Bash` tool with
   `run_in_background: true`. It polls across turns on its own; the harness
   re-invokes the agent **only when the command exits**. Idle polls are absorbed
   by the loop's internal `sleep` and produce no stdout, so an idle watch wakes
   the model **zero** times.
2. **A delta wakes the agent exactly once.** The detector exits `2`, the watcher
   prints just the payload (PR number(s) / run id(s)), and the harness re-invokes
   the agent with that payload — nothing else. The exit-`0` "nothing changed"
   branch never reaches the model.
3. **Re-arm is mechanical, not a model choice.** After finishing a review batch
   (and applying `agent-reviewed` / bumping the run marker), re-launch the
   watcher the same way — one background `Bash` call — **before the turn ends**.
   Do not rely on "remembering to loop"; the relaunch is a required step, like
   the label.
4. **`ScheduleWakeup` is only a long fallback heartbeat** (>=1800s) in case a
   background task dies silently — never the primary pacing mechanism. Do **not**
   use a short-interval wakeup to poll; the background-task exit is the wake
   signal, and polling on top of it just burns turns.

Run both watchers as two independent background tasks to cover merged PRs and
heavy runs at once; each re-invokes the agent on its own delta.

### Codex

Codex does not expose Claude Code's `run_in_background` re-invoke-on-exit or
`ScheduleWakeup` mechanism in this shared skill context. Current Codex surfaces
do have foreground/ongoing command sessions, CLI background terminals, and
Codex app automations/thread automations, but do **not** assume any of those will
automatically hand this thread back the watcher payload when a process exits.

Use one of these Codex-safe paths instead:

- **Run detectors once per turn.** This is the simplest path when you are already
  active: run `merged-prs-needing-review.sh` and, when heavy workflows exist,
  `test-runs-needing-review.sh`. Exit `0` means no delta; exit `2` means review
  the printed payload.
- **Run watchers in foreground/managed sessions.** Start `watch-merged-prs.sh`
  and `watch-test-runs.sh` as normal foreground commands or explicitly managed
  exec sessions, optionally bounded with `timeout`. Poll or interrupt those
  sessions yourself, and process exit `2` as the delta. Stop them before a final
  response or workflow change.
- **Use Codex app automations only when deliberately available.** A thread
  automation can schedule the detector check, but it is a Codex app feature, not
  the Claude Code background-task wake path.

On Codex, the markers still keep review idempotent. You lose the zero-idle-cost
guarantee, not correctness or determinism.

## Workflow

1. Start the watch using the surface-specific path above.

   Claude Code: arm both watchers as background `Bash` tasks with
   `run_in_background: true` so idle polls never reach the model:

   ```bash
   .codex/skills/review-merged-prs/scripts/watch-merged-prs.sh
   .codex/skills/review-merged-prs/scripts/watch-test-runs.sh
   ```

   Codex: do not use `run_in_background`. Either run the detectors once per
   turn, or run the same watcher commands in foreground/managed sessions and
   explicitly poll/stop them.
2. When the active watch path reports exit `2`, read its payload for the PR
   number(s) or heavy-run id(s) to review.
3. Fetch PR context with `gh pr view <N> --json ...` and `gh pr diff <N>`.
4. `git fetch origin main` and fast-forward local `main` with
   `git merge --ff-only origin/main`.
5. Review the merged code in context. Read surrounding files, tests, configs,
   generated output, and existing workflow code as needed. If you fetched diffs
   before fast-forwarding, re-read the current files after the fast-forward so
   stale pre-merge content does not leak into the review. Look for feature
   interactions, not only line-local bugs.
6. Run validation appropriate to the change. For this repo, default to
   `npm test` and `npm run build` for source changes. For external feed/source
   PRs, also do a live shape spot-check when safe; keep tests hermetic, but
   quantify live shape/backfill risk in the review notes.
7. **Evaluate the PR's test quality**, not just that coverage is green (CI
   already gates that). Read the diff's tests against "Evaluating test quality"
   below; a thin-coverage gap is an actionable finding, filed as a test-scenario
   issue in the same pass as correctness findings.
8. **File an issue for each actionable finding**, following
   `references/finding-issue.md` (a `agent-review` label plus the usual type/area
   labels; reference the source `PR #N` in the body). Search existing issues
   first, and read each candidate **in full — body AND comments**
   (`gh issue view N --json body,comments` or `--comments`), never body-only: a
   later comment may already cover the finding or refine the spec. If an existing
   issue already covers the finding, add a comment with the PR-specific context
   to that issue instead of filing a duplicate. Do not post the finding as a PR
   comment or PR review. If there are no actionable findings, file nothing.
9. **Mark the merged PR reviewed** regardless of outcome:

   ```bash
   gh pr edit <N> --add-label agent-reviewed
   ```

10. **Re-arm before the turn ends when the surface supports a persistent
    watch.** For a heavy-run audit, bump the marker
    (`test-runs-needing-review.sh --mark <run-id>`) as the analogue of step 9's
    label. Then run the relevant detector once to confirm it is clean. On
    Claude Code, re-launch the watcher as a background task (step 1). On Codex,
    restart or continue the explicit foreground/session/automation path you
    chose, accepting that idle is not zero-token unless a Codex automation owns
    the cadence. Stop running watch tasks before final responses or workflow
    changes.

## Open PR Reviews

When reviewing an open PR under this workflow or while orchestrating issue work,
use the same finding route: actionable findings become `agent-review` issues, or
issue comments on an existing covering issue. Do **not** submit findings as PR
comments. Mention the PR number and URL in the issue body so GitHub cross-links
the PR and the backlog item.

Do not apply `agent-reviewed` to open PRs; that label is only the merged-PR
detector's marker. For open PRs, report the issue URLs to the user and hold or
merge according to the normal review tier.

## Auditing scheduled heavy-test runs

When `test-runs-needing-review.sh` / `watch-test-runs.sh` surfaces a completed
heavy run (mutation / e2e / fuzz), the work is not a PR-diff review — it's an
**artifact audit**. The fast `npm test` gate proves coverage, not efficacy, and
can't reach production-only behavior; these runs are where test-efficacy gaps and
#123-class production bugs surface. Apply the framework
**baseline → delta → attribute → triage → file**, in full, from
`references/heavy-run-audit.md`. In short:

1. **Baseline → delta, never absolute.** Audit the run against the **last
   reviewed run of the same kind** (the per-kind marker, below). The signal is the
   *change* — new surviving mutants, a score drop, new e2e failures/flakes, a new
   fuzz counterexample — not the standing count. Diff the two runs' artifacts.
2. **Attribute** each new finding to the PR(s) merged **in that window** (the same
   window `merged-prs-needing-review.sh` walks), so the filed issue names the
   likely cause.
3. **Triage real-vs-noise, per kind** (full rules in the reference):
   - **Mutation** (`mutation-report` artifact → `reports/mutation/mutation.json`):
     a new `Survived` mutant in changed code = weak/missing assertion → file a
     test-scenario issue. Distinguish **equivalent** mutants (can't change
     observable behavior — redundant guards, logging, registry *data* like
     `src/ingest/sources.ts`) → suppress, don't file. New `Timeout`/runtime error
     = possible infinite-loop/config break → file. Don't re-file the score
     regression `mutation.yml` already tracks; file the per-mutant delta.
   - **e2e** (`playwright-report` artifact → `playwright-report/results.json` +
     `test-results/`): a real failure against the **served build** that the
     hermetic suite missed = #123-class production bug → High-severity issue. A
     *flaky* spec (passes on retry) → file as flaky, don't block.
   - **fuzz**: no fuzz workflow exists yet (the detector reserves the slug); when
     one lands, a new counterexample → file with the minimal repro.
4. **Dedup against the backlog** before filing — read each candidate issue in full
   (body AND comments), exactly as the PR-review path does.
5. **File** one `agent-review` issue per genuine new finding (`finding-issue.md`),
   then bump the per-kind marker (`--mark <run-id>`) — the heavy-run analogue of
   the `agent-reviewed` label.

**Suppression lists** keep the delta meaningful (otherwise known noise re-fires as
"new" each run). `stryker.config.json` has no per-mutant ignore list, so a
*confirmed-equivalent* mutant is suppressed with a Stryker-native inline
`// Stryker disable next-line all: equivalent — <reason> (PR #N)` at the mutant
site (lives next to the code, goes through PR review); a *confirmed-flaky* e2e
spec is recorded in its filed `testing` issue (kept open as the durable record)
and, if loud, quarantined with a Playwright annotation. The reference doc explains
the trade-off and the alternative (a single in-repo equivalents list) flagged for
review.

**Idempotency marker.** Heavy runs can't carry a label, so the detector persists a
**per-kind last-reviewed-run-id** marker (`--mark` into a local `--state-dir`;
already implemented). First sight of a kind seeds the baseline silently and fires
on the *next* run, so step 1 always has a prior run to diff against. The marker is
*which run was last audited*; the suppression lists are *which findings are known
noise* — both are required.

## Evaluating test quality

A PR can sit at 100% coverage and still test nothing — the gate proves lines
*ran*, not that anything was *asserted*. Judge the diff's tests against the
`testing` skill's bar ("assert behavior, never just cover"); the gap is the
finding, not the coverage number. Look for:

- **Cover-without-assert** — `toBeDefined` / `not.toThrow` / `toBeTruthy` on a
  value with a knowable exact shape; a snapshot that never reads a field; a
  branch whose asserted value is identical on both sides (invert it and the test
  still passes). The test is padding the gate, not pinning a contract.
- **Untested edges** — only the happy path, no empty / zero / off-by-one /
  `null` / malformed-input case. For an `src/ingest/parse/**` parser of untrusted
  input, the robustness contract (returns a well-formed `ParsedItem[]` or throws
  *only* the documented `"not a … feed"` guard — never a raw
  `TypeError`/`RangeError`, never hangs) must be exercised.
- **No regression test for the bug the PR fixed** — a bug-fix PR that lands
  without a test reproducing the bug will silently regress. That missing test is
  itself the finding.

When you find a gap, **file a test-scenario issue** so it's pick-up-able work,
not a comment that scrolls away — the same route correctness findings take.
Name the **file + function**, the **scenario** (the input/edge), and the
**assertion** that would catch the bug, so an implementer can write it without
re-deriving the PR. Follow the test-scenario shape in
`references/finding-issue.md`; label it `agent-review` plus `testing` and
`bug`/`enhancement` per the `filing-issues` skill. Search first — augment an
existing covering issue rather than duplicating.

## What counts as a finding

File issues only for **actionable** findings — a concrete bug, regression,
operational risk, or **test-quality gap** (above), with file:line and a
user-visible, operational, or coverage-credibility impact. Use `High` / `Medium`
/ `Low` severity in the issue body. Don't file issues for style nits or to
restate the PR summary. For merged PRs, when a review is clean, the
`agent-reviewed` label alone records that it happened; for open PRs, simply
report that no actionable findings were found.

## Finding-issue format

Read `references/finding-issue.md` before filing finding-issues. It defines the
issue title/body template, severity, and which labels to apply.

## Heavy-run audit framework

Read `references/heavy-run-audit.md` before auditing a scheduled heavy-test run
(mutation / e2e / fuzz). It is the full baseline → delta → attribute → triage →
file framework summarized under "Auditing scheduled heavy-test runs" above: the
verified artifact names, the per-kind real-vs-noise triage, the equivalent-mutant
and known-flaky suppression mechanisms, and how the per-kind marker fits.

## Session Learnings

Read `references/session-learnings.md` when reviewing this repo or improving the
workflow. It captures failure modes found during the initial long-running
monitoring session, including generated artifact checks, URL state loss, live
feed shape validation, and large historical backfills.
