---
name: Filing & organizing issues
description: Conventions for creating and organizing GitHub issues in this repo — when to file, the issue structure, the type × area label taxonomy you can point an agent at, native sub-issues for epics, and what to deliberately skip (milestones/projects). The backlog is the single source of truth; this keeps it queryable and steerable.
when_to_use: Filing a new GitHub issue; choosing labels; grouping or organizing the backlog; deciding whether to reach for sub-issues, milestones, or a project; pointing an agent at a group of issues to work on. (For *executing* a backlog with sub-agents, see the issue-orchestration skill instead.)
---

# Filing & organizing issues

The backlog lives in **GitHub issues** (`gh issue list`, `gh issue view`), not in
README TODOs or CLAUDE.md. File an issue when work is requested or discovered but
not done now; close it from a PR with **`Fixes #N`** in the PR body. The guiding
principle for *organizing*: process must pay for itself in **agent steerability**
(a queryable, self-describing backlog), not ceremony — this is a solo + agents
hobby repo, so a thin scheme that's actually maintained beats elaborate
machinery that rots into misleading noise.

## Before filing: don't duplicate

Search first (`gh issue list --search "…"`, `--state all`). If an issue already
covers it, **augment or cross-link it** rather than opening a near-duplicate —
e.g. broaden it with a comment, or reference it from the new one. Precedent:
the trailing-slash bug was added to #81 by comment; the coverage-metrics and
e2e-policy research were folded into #75 and #77.

## Issue structure

Keep issues scannable and self-contained so an agent can pick one up cold. The
working shape:

- **Goal** — one or two sentences on the outcome.
- **Why** — the motivation / the problem being solved.
- **Scope** — concrete steps or surfaces touched (file paths help).
- **Acceptance** — how we know it's done; gate green; tests/docs updated.
- **Related** — cross-link issues with `#N`.

Flag **human-gated** changes explicitly in the body: anything that edits
`docker/**` / the agent image, adds a heavyweight tool or new devDependency, or
touches `.github/workflows/*` needs an explicit human go-ahead before the PR
merges (see CLAUDE.md / the container tool policy).

## Labels: two orthogonal axes

Every issue carries a **type** and (usually) one **area**.

**Type** — GitHub's stock labels: `bug`, `enhancement`, `documentation`
(plus `duplicate` / `wontfix` / `question` as needed).

**Area** — this repo's loose grouping taxonomy. Its whole job is steering: *"work
the testing group"* → `gh issue list --label testing`.

| Area | Scope |
|---|---|
| `codex` | The Codex-as-coding-agent epic (#82) and its sub-issues |
| `testing` | Test suite, coverage, e2e, testing strategy/tools |
| `ingest` | Feeds, parsers, the ingestion pipeline & item data model |
| `ui` | Frontend pages/components, styling, routing & UX behavior |
| `auth` | Accounts, login/signup, sessions, the auth guard, auth email |
| `agent-infra` | Agent container, `bin/claude` launcher, Docker, CI/CD |

Conventions:
- One area is the norm; a genuinely cross-cutting issue can carry **two** (e.g.
  the signup bug #95 is `auth` + `ui`). A pure-meta issue (e.g. the README #90)
  may have **no** area — that's fine.
- Add a **new** area label only when a genuinely new theme appears and recurs —
  don't proliferate. A new area is a deliberate taxonomy change, not a reflex.

## Epics: native sub-issues, not a board

When an issue genuinely decomposes into children (a real parent → child
hierarchy, like the Codex epic), use GitHub **sub-issues** — you get a free
"X of Y done" progress bar and a clean hierarchy without any board. Wire a child
to a parent via the REST API (the child id is the *database* id, not its number):

```sh
child_id=$(gh api repos/couetilc/news/issues/<CHILD> --jq .id)
gh api -X POST repos/couetilc/news/issues/<PARENT>/sub_issues -F sub_issue_id="$child_id"
# list:   gh api repos/couetilc/news/issues/<PARENT>/sub_issues --jq '.[] | "#\(.number) \(.title)"'
```

For issues that are merely *related* (no real hierarchy), a shared **area label**
is enough — don't manufacture an epic.

## What to deliberately skip (and why)

- **Milestones** — only earn their keep with a real *dated release*. If there's
  ever a "v1 / MVP ship" target, use **exactly one**; otherwise the % bar is
  vanity and goes stale.
- **Projects (v2) boards** — a team-coordination tool. For a solo dev + agents it
  mostly duplicates `gh issue list --label` at a real maintenance cost. Use only
  if a board view is personally wanted, not by default.
- **Issue types** (org-level Bug/Feature/Epic) — **unavailable**: this is a
  user-account repo, not an org. The label axes above cover the same need.

## gh cheat-sheet

```sh
gh issue create --title "…" --label enhancement,testing --body "…"   # file (type + area)
gh issue list --label testing                                        # work a group
gh issue list --label auth --label ui                                # intersection of areas
gh issue edit <N…> --add-label ingest                                # (re)label one or many
gh issue view <N> --comments                                         # read before augmenting
# close from a PR: put "Fixes #N" in the PR body
```
