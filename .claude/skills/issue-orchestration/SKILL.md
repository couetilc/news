---
name: Issue orchestration
description: How to drive a GitHub-issue backlog to completion with parallel in-session sub-agents doing the implementation while you orchestrate and review every PR — the dispatch/review/merge loop, dependency & file-collision triage, merge mechanics, and the hazards learned from the first full run.
when_to_use: When asked to orchestrate / drive / implement multiple GitHub issues (a backlog) by delegating to sub-agents rather than coding it yourself, and to review each resulting PR. Also for planning how to parallelize issue work, sequencing dependent or coupled PRs, or landing many PRs that touch shared files.
---

# Issue orchestration

Driving a GitHub-issue backlog to completion with **in-session sub-agents** doing the
implementation while **you orchestrate and review every PR**. Distilled from the first
full run (20 issues → 20 PRs in one session). Defer to `CLAUDE.md` for the dev loop,
testing policy, and deploy flow; this skill is the *meta*-process layered on top.

## Role split

- **You (orchestrator):** triage the backlog, dispatch implementers, review each PR's
  diff, resolve cross-PR conflicts at merge, gate merges, keep the user informed. You do
  **not** write feature code.
- **Implementer sub-agent:** one per issue, in an isolated git worktree; implements to the
  issue's acceptance criteria, keeps `npm test` green, opens a PR with `Fixes #N`, and
  **STOPS — never merges**.
- **The user:** signs off on the merge of the architectural / security / CI tier.

## The loop

1. **Triage** the backlog → a dependency + file-collision map (see below).
2. **Dispatch** ~3–4 implementers at a time (worktree-isolated, `run_in_background`).
3. **Review** each PR as it lands; bounce findings or approve.
4. **Land** approved PRs (merge mechanics below); **hold** the architectural tier for the
   user's sign-off.
5. **Verify** deploy + production after merges. Repeat until the backlog is clear, then a
   final sweep (no open issues/PRs, deploy green, branches/worktrees tidy).

Track everything with one task per issue (`TaskCreate`). Stash `agentId`, `pr`, `review`
status, and any pre-assigned shared resource (e.g. a swatch hex) in task **metadata** so
it survives context summarization. Use `addBlockedBy` for hard dependencies.

## Triage: dependencies AND file collisions (the crux)

Two graphs decide ordering — and **collisions dominate**:

- **Hard dependencies** — e.g. a public page needs the auth middleware first; sources that
  reuse a new abstraction need it landed first. Encode as `blockedBy`.
- **File collisions** — PRs that append to the same file/region conflict at merge even when
  logically independent. Find the **contention zones** (a shared registry array, a vitest
  config's include list, the homepage) up front.

Then group:

- **Independent & repeatable** (e.g. one feed-source per issue): parallelize the *build*,
  but they collide on shared registry files → **"parallel build, serial merge"**.
- **Coupled** ("whichever ships second wires the other together"): serialize — build the
  second only *after* the first merges, so it integrates against reality, not a guess.
- **Architectural / security / CI**: build + review + **hold for user sign-off**. Build
  them anyway — a concrete reviewed diff is what unblocks the user, and it doesn't stall
  the rest of the pipeline.

## Dispatching implementers — the brief that works

`Agent` with `isolation: "worktree"` + `run_in_background: true`; launch a batch in one
message so they run concurrently. Cap at ~3–4 to keep merge-conflict load and review
quality manageable. Each brief contains:

- The issue: tell them to `gh issue view N` and follow it exactly.
- Conventions: `CLAUDE.md` + the relevant skill(s) (e.g. design-system for UI).
- The pattern to mirror: point at the **canonical example file** for this kind of change.
- Constraints: branch off main (never commit main), `npm ci` first, `npm test` must pass
  at 100% line/branch across **both** vitest projects, tests hermetic (no network — inject
  `fetch`, use fixtures).
- **Pre-assigned shared resources** (see hazards) so parallel agents don't collide.
- Deliverable: `gh pr create --fill` with `Fixes #N`; **do NOT merge**; report PR #/URL,
  files changed, the coverage line, and **flag any uncertainty or deviation rather than
  guessing silently**.

Agents may use WebFetch to *verify* real external shapes (feeds/APIs), but the **tests
must stay fixture-driven/hermetic**.

**Agents branch fresh from `main` — never hand a background agent an existing branch.**
Worktrees isolate working files but **share branch refs**, and a branch can be checked out
in only one worktree at a time. Revising an *existing* PR (e.g. applying review feedback,
reworking an open PR) is **integration work the orchestrator does itself** on that branch —
not a job for a concurrent background agent, which collides on the shared checkout (see the
git-collision hazard below).

## Reviewing PRs

Read the diff against the acceptance criteria + conventions; judge test *quality*, not the
percentage (CI enforces 100%). Look hardest at:

- **Shared-code changes** — a parser/helper used by everything; verify existing behaviour
  is preserved byte-for-byte and only the new branch is added.
- **Security** — auth, hashing/constant-time compare, server-side write rejection.
- **Core-abstraction changes** — confirm they don't regress the existing callers.

Two merge tiers:

- **Low-risk → auto-merge after your review** (additive sources, infra docs, isolated
  features).
- **Architectural / security / CI → hold for the user** (auth, abstraction changes, any
  `.github/workflows/*` edit) — plus anything whose issue/PR body asks for human approval
  before merge. Present these with your review notes + a recommendation.

## Merge mechanics (the recipe)

Each branch was cut from an older `main`; contention-zone PRs conflict once the first
lands. Per PR, operate in its worktree with `git -C <worktree>` (it already has
`node_modules`):

1. `git rebase origin/main` → resolve conflicts as **unions** (keep all prior entries, add
   this one — never drop a sibling's). Reliable trick: `git checkout --ours -- <file>`
   yields main's current version; then re-apply just this PR's additions to it.
2. `npm test` → must be 100%.
3. `git push --force-with-lease`.
4. **Wait for the CI run on the EXACT pushed SHA** before merging:
   `gh run list --branch <b> --json headSha,status,conclusion --jq '.[]|select(.headSha=="<SHA>")|...'`.
   A green run for an *older* SHA is a trap — the PR stays `BLOCKED` until the new run
   lands. (`gh pr view --json mergeable,mergeStateStatus` confirms.)
5. `gh pr merge <N> --squash` (omit `--delete-branch` while the branch is checked out in a
   worktree; clean up later).
6. `git fetch origin main` before the next one.

**Delegate the mechanical landing** of a batch of *already-reviewed* low-risk PRs to a
single **integration agent** (rebase → resolve unions → test → push → CI-on-SHA → merge,
in order) to save your own turns — but keep architectural/production merges in your own
hand (merges deploy).

## Structural hazards (and the fixes)

- **Shared-registry append conflicts** — inevitable for repeatable sources. Accept "build
  parallel, merge serial"; resolve as unions. **De-brittle exact-list test assertions
  early** (convert `expect(list).toEqual([...])` to per-item `toContain`) so they survive
  siblings.
- **Independently-chosen shared resources collide** — parallel agents all picked green
  swatches; two agents both created `atom.ts`. **Fix:** *pre-assign* shared resources (a
  coordinated palette) in each brief. For a new shared module, either land it once first
  and have the others reuse it, or pick a **canonical** implementation at merge and have
  the duplicates drop theirs (then port any unique tests).
- **Stale-SHA CI trap** — always confirm the green run's `headSha` equals your pushed SHA
  before merging.
- **No `SendMessage` to a finished agent** — to bounce a fix, either hand-resolve it
  (conflict resolution / a one-line value is integration, not implementation) or spawn a
  fresh agent scoped to the change.
- **Worktree/branch lifecycle** — completed agents leave worktrees on disk with their
  branch checked out, which blocks re-checkout and branch deletion. `git worktree remove
  --force <path>` the finished ones to free branches before an integration agent (or you)
  operates on them.
- **Orchestrator/agent git collision in `/workspace`** — running a background worktree
  agent *while you also hand-edit and commit in `/workspace`* can fuse their work:
  worktrees share branch refs **and** you both act on the same repo, so the agent's
  checkout/stage can leak into `/workspace`'s HEAD and index — and a bare `git commit` then
  sweeps it into your commit, on the wrong branch. (Hit once: a #83 commit swallowed a
  concurrent agent's PR-revision; caught pre-push, `origin` was intact, redone serially.)
  **Three independent fixes — apply all:** (1) **don't author in `/workspace` while agents
  run** — serialize your own pieces (do them before dispatching or after agents finish), or
  keep `/workspace` review/merge-only; (2) **scope every commit to explicit pathspecs**
  (`git commit -- <files>`, never a bare index commit) and `git status` right before, so
  leaked staging can't ride along; (3) **agents get fresh branches off `main`** (above), so
  there's no shared-branch checkout to collide on.

## Production awareness

A merge **deploys**. Know the user-visible effect *before* merging: e.g. adding an auth
gate makes the whole site login-only — fast-follow the public page, and expect your `curl`
health check to return `303`, not `200`. Verify the deploy conclusion and `curl` the live
site after each significant merge.

## Branch cleanup — do it carefully (learned the hard way)

**Scope deletions to branches *this run created*, and verify merged-status *before*
deleting.** A blanket "delete every non-`main` branch" once deleted a pre-existing,
**unmerged** branch nobody asked to touch.

- Don't bulk-delete. Delete only your known branch names, each after confirming it's an
  ancestor of / merged into `main` (`git merge-base --is-ancestor <sha> origin/main`).
- If you over-delete: a deleted branch's tip SHA is recoverable from
  `gh api repos/OWNER/REPO/activity` (find the `branch_deletion` entry's `before=<sha>`),
  and restorable with
  `gh api -X POST repos/OWNER/REPO/git/refs -f ref=refs/heads/<name> -f sha=<sha>`.
- General rule: before deleting/overwriting anything you didn't create, look at it first;
  if it contradicts how it was described, surface that instead of proceeding.

## Standing reminders

- Don't use harness file-memory (it doesn't survive the agent container); durable learnings
  — like this skill — ship as a PR.
- File issues for discovered-but-deferred work (`gh issue create`).
- Keep the user informed at each checkpoint, and reserve `AskUserQuestion` for genuine
  forks (merge sign-offs, scope, sequencing) — settle the rest with sensible defaults.
