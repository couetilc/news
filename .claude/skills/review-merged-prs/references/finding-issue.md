# Finding-Issue Format

Actionable findings from any in-context PR review — open or merged — become
**GitHub issues**, not PR comments, PR reviews, or entries in a committed file.
The backlog is the single source of truth (see the `filing-issues` skill). File
one issue per actionable finding.

## When to file

File an issue only for an **actionable** finding: a concrete bug, regression,
operational risk, or **test-quality gap** (a thin or missing test the review
caught — see the skill's "Evaluating test quality") with a file/line and a
user-visible, operational, or coverage-credibility impact. Do not file for style
nits or to restate the PR summary. If an existing issue already covers the
finding, add the PR-specific context as an **issue comment** instead of opening a
duplicate. Do not use a PR comment as the finding record. A clean merged-PR
review files no issue — the `agent-reviewed` label on the PR records that the
review happened.

## Issue template

Title: `<Severity>: <short description> (PR #N)`

Body (markdown):

    Found in an in-context review of PR #N (<pr-url>).

    - Severity: `High` | `Medium` | `Low`
    - PR state: `Open as of <ISO_TIMESTAMP>` | `Merged at <ISO_TIMESTAMP>`
    - Location: `path/to/file.ts:line`
    - Reviewer model: `<model type, e.g. GPT-5 Codex / Claude Opus>`

    ## Problem
    What the code does and why it is wrong or risky. Describe the runtime
    behavior and the user-visible or operational impact — not a style preference.

    ## Expected / fix
    The expected behavior, or the concrete fix/decision. Include enough context
    for a different coding agent to fix it without reading the whole PR thread.

    ## Validation
    Commands run and their results during review. Note anything relevant that was
    not run (e.g. a live-feed assumption that could not be reproduced).

## Test-scenario issue (test-quality gap)

For a thin or missing test, keep the same title/header block but make the body a
ready-to-implement test spec, not a bug report:

    ## Gap
    Why the current test doesn't prove the behavior — cover-without-assert, an
    untested edge, or no regression test for the bug this PR fixed.

    ## Scenario to add
    - File + function: `test/…` testing `src/…#fn`
    - Input / edge: the exact case (empty / zero / off-by-one / `null` /
      malformed / the bug's reproduction)
    - Assertion: the exact observable result that would fail today and catch the
      regression — not `toBeDefined`.
    - Project: `workers` or `node` (per the `testing` skill).

Label `agent-review` + `testing` + `bug` (a regression-test gap) or
`enhancement` (a missing edge/scenario). Severity is the blast radius of the
*untested* behavior, not the test itself.

## Labels

Apply via `gh issue create --label ...`:

- `agent-review` (marks it a post-merge review finding), **plus**
- the normal **type** label (`bug` / `enhancement` / `documentation`) and a
  relevant **area** label, per the `filing-issues` skill.

## Severity

- `High` — data loss, security, or a broken core flow reaching production.
- `Medium` — a real bug or regression with a workaround, or notable operational
  risk (e.g. an unbounded historical backfill).
- `Low` — minor correctness/robustness issue with a small blast radius.

## Marking the PR reviewed

For merged PRs, after filing any finding-issues (or none), tag the PR so the
detector stops surfacing it:

```bash
gh pr edit <N> --add-label agent-reviewed
```

A merged PR counts as reviewed once it carries `agent-reviewed`, independent of
whether its finding-issues are still open. Do not apply `agent-reviewed` to open
PRs.
