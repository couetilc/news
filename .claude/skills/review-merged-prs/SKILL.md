---
name: review-merged-prs
description: Detect newly merged GitHub pull requests, perform in-context PR reviews, file actionable findings from open or merged PRs as GitHub issues, and mark each reviewed merged PR with a label. Use when asked to watch PR merges, review merged or open PRs, route findings into the issue backlog, distinguish already-reviewed merged PRs from new ones, or help another agent pick up open review findings. Pairs with issue orchestration.
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

- `scripts/merged-prs-needing-review.sh`: list merged PRs that do **not** carry
  the `agent-reviewed` label. Exits `0` when none, `2` when one or more need
  review.
- `scripts/watch-merged-prs.sh`: poll the detector every `INTERVAL` seconds
  (default `60`) and stop with exit `2` when a merged PR needs review.
- `scripts/review-followups.sh`: list open `agent-review` finding-issues so a
  follow-up agent can pick them up.

## Workflow

1. Start or resume the watch loop:

   ```bash
   .codex/skills/review-merged-prs/scripts/watch-merged-prs.sh
   ```

2. When the loop exits `2`, read the detector output for the PR number(s).
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

10. Run the detector once. If clean, restart the watch loop. Stop running watch
    sessions before final responses or workflow changes.

## Open PR Reviews

When reviewing an open PR under this workflow or while orchestrating issue work,
use the same finding route: actionable findings become `agent-review` issues, or
issue comments on an existing covering issue. Do **not** submit findings as PR
comments. Mention the PR number and URL in the issue body so GitHub cross-links
the PR and the backlog item.

Do not apply `agent-reviewed` to open PRs; that label is only the merged-PR
detector's marker. For open PRs, report the issue URLs to the user and hold or
merge according to the normal review tier.

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

## Session Learnings

Read `references/session-learnings.md` when reviewing this repo or improving the
workflow. It captures failure modes found during the initial long-running
monitoring session, including generated artifact checks, URL state loss, live
feed shape validation, and large historical backfills.
