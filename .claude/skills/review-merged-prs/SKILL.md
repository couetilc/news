---
name: review-merged-prs
description: Detect newly merged GitHub pull requests, perform in-context post-merge code reviews, file actionable findings as GitHub issues, and mark each reviewed PR with a label. Use when asked to watch PR merges, review merged PRs, turn review findings into the issue backlog, distinguish already-reviewed merged PRs from new ones, or help another agent pick up open review findings.
when_to_use: Watching a GitHub repo for merged PRs and reviewing them post-merge; turning review findings into tracked issues; telling which merged PRs still need review; handing actionable findings to another coding agent via the backlog. Pairs with the issue-orchestration skill (Claude lands PRs; this reviews them).
---

# Review Merged PRs

## Purpose

Watch a GitHub repo for merged PRs, review each merged change in the current
agent context, and route the result into the project's **issue backlog**:
actionable findings become GitHub issues; every reviewed PR is tagged with the
`agent-reviewed` label. Reviews are **post-merge**. Findings are **not** written
to a committed file and **not** posted as PR comments — they live as issues, the
backlog's single source of truth.

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
   generated output, and existing workflow code as needed. Look for feature
   interactions, not only line-local bugs.
6. Run validation appropriate to the change. For this repo, default to
   `npm test` and `npm run build` for source changes. For external feed/source
   PRs, also do a live shape spot-check when safe.
7. **File an issue for each actionable finding**, following
   `references/finding-issue.md` (a `agent-review` label plus the usual type/area
   labels; reference the source `PR #N` in the body). If there are no actionable
   findings, file nothing.
8. **Mark the PR reviewed** regardless of outcome:

   ```bash
   gh pr edit <N> --add-label agent-reviewed
   ```

9. Run the detector once. If clean, restart the watch loop. Stop running watch
   sessions before final responses or workflow changes.

## What counts as a finding

File issues only for **actionable** findings — a concrete bug, regression, or
operational risk, with file:line and user-visible or operational impact. Use
`High` / `Medium` / `Low` severity in the issue body. Don't file issues for style
nits or to restate the PR summary; when a review is clean, the `agent-reviewed`
label alone records that it happened.

## Finding-issue format

Read `references/finding-issue.md` before filing finding-issues. It defines the
issue title/body template, severity, and which labels to apply.

## Session Learnings

Read `references/session-learnings.md` when reviewing this repo or improving the
workflow. It captures failure modes found during the initial long-running
monitoring session, including generated artifact checks, URL state loss, live
feed shape validation, and large historical backfills.
