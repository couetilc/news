# CLAUDE.md

## Project and scope

A personal, single-user news aggregator for Connor (GitHub: couetilc), served at
https://news.cuteteal.com on Cloudflare Workers. Official feeds enter D1; the
owner gets a read/unread digest behind email/password auth. Anonymous visitors
get a public read-only feed and deployment metadata. Keep that boundary intact;
additional-user auth is not a current product goal.

## Authorization

Work autonomously within Connor's approved scope: implement, validate, commit,
push, open a PR, and merge/deploy after required checks and review. Existing
authorization covers matching follow-through steps; do not request the same
approval again because a change touches a skill, dependency file, workflow, or
container configuration.

Ask before introducing an unapproved substantive decision: changing product
scope or standing agent permissions; materially changing authentication,
authorization, credential access or public data exposure; destructive production
data operations; a new service, recurring cost or significant dependency/trust
change; or substantive public/portfolio claims. Prepare the concrete diff and
evidence first, continue independent work, and present the decision at the final
relevant step. Do not exercise an unapproved consequence merely to validate it.

Ordinary maintenance, compatible dependency updates, factual documentation
corrections, tests and reversible implementation choices proceed through normal
review and CI. A separate proposal issue or package-only PR is useful only when
it makes a real decision easier to review. Human approval does not require Connor
to personally press Merge. This section is the shared policy for repo skills.

## Stack and configuration

- Astro 7, `output: 'server'`, Cloudflare adapter v14. Dev runs in workerd with
  local bindings. Build emits `dist/server/` and a Wrangler config redirect;
  root `wrangler deploy` resolves the emitted config. Inspect `astro.config.mjs`.
- SSR is the default. Session-adaptive pages, especially `/status`, stay SSR.
  `src/layouts/Layout.astro` mounts `ClientRouter`; auth/session forms use
  `data-astro-reload` for real document navigation.
- D1 holds items, users, read state and feed health. Astro Sessions uses the
  `SESSION` KV binding. `imageService: 'compile'` avoids runtime Images usage.
- `wrangler.jsonc` is the infrastructure source of truth: bindings, cron,
  `nodejs_compat`, account, custom domain. Run `npm run cf-typegen` after changing
  it and commit `worker-configuration.d.ts`. Update `.env.example` when required
  tooling-token scopes change.
- Node 24 is the working pin; `package.json` declares the supported floor. Use
  npm and commit `package-lock.json`. Follow the Dependencies skill when a
  package choice needs evaluation.

## Native laptop setup

Use installed Codex or Claude tools directly. `.envrc` leaves PATH unchanged;
`codex` and `claude` must not resolve under `.agent/bin`. Docker is not required.

1. Branch before editing: `git checkout -b <topic>`. A separate worktree is useful
   for concurrent work: `git worktree add -b <topic> <path> origin/main` after
   fetching. Run subsequent commands in that worktree.
2. `npm ci`; `npm run db:migrate:local`; `npx playwright install chromium`.
   SessionStart bootstrap is cloud-only; it does not install native dependencies.
3. Use ignored `.dev.vars` for local runtime secrets, with a fresh local-only
   `AUTH_PEPPER`. Never copy production secrets or another worktree's sessions.
4. `npm run dev -- --host 127.0.0.1`, with a distinct `--port` for concurrent
   servers. Use the printed address; preserve servers and state owned by others.
   The e2e launcher owns a separate build/state/port.

Worktrees have separate HEAD/index files but share refs. Give each task an owned
branch; avoid simultaneous writers to one branch or PR. Inspect dirty and
unpushed state before cleanup. Remove only worktrees/branches created for the
task after verifying their delivery; do not force removal to hide conflicts or
uncommitted work. A squash merge is verified by the merged PR, tested head and
resulting diff/tree, not branch ancestry alone.

Optional container/cloud setup and credential checks live in the
[environment skill](.claude/skills/agentic-environments/SKILL.md).

## Commands

- `npm run dev` — Astro/workerd development server.
- `npm test` — both Vitest projects and the 100% Istanbul coverage gate.
- `npm run test:e2e -- [spec/options]` — isolated Chromium tests through
  `e2e/run.mjs`; use this launcher, not direct `playwright test`.
- `npm run test:mutation` — advisory Stryker run, separate from `npm test`.
- `npm run build` / `npm run preview` — build and serve the built Worker.
- `npm run deploy` — manual build/deploy fallback from an authenticated machine.
- `npm run cf-typegen` — regenerate binding types.
- `npx wrangler tail` — live production logs; historical inspection is described
  in the [observability skill](.claude/skills/cloudflare-observability/SKILL.md).
- `npx wrangler secret put <KEY>` — production runtime secret configuration.

## Credentials

`.env` is ignored tooling configuration; `.env.example` documents purposes and
scopes. Runtime secrets belong in `.dev.vars` locally and Wrangler secrets in
production. Keep credential values out of logs, chat, fixtures and commits.

Native GitHub authentication can use the gh keyring over HTTPS or SSH keys.
Inspect `git remote get-url origin` and `gh auth status`; do not assume transport
or add tokens when existing authentication works. Workflow-file pushes need
workflow permission (OAuth/classic PAT `workflow`, or fine-grained Workflows
write), including on laptops. A successful ordinary push does not prove it.
Use an already authorized connected GitHub integration when appropriate.

Cloudflare inspection/manual deployment uses the existing local `.env` token or
Wrangler OAuth; CI uses the `CLOUDFLARE_API_TOKEN` repo secret. Local bindings and
tests need no production credentials. Optional cloud sessions remain free of
Cloudflare credentials and deploy through CI.

## Tests and review

`npm test` must pass before each commit at 100% statements, branches, functions
and lines over authored `src/**`. Istanbul works in workerd; V8 coverage does
not. The [Testing skill](.claude/skills/testing/SKILL.md) describes runtime
placement, hermetic fixtures, parser robustness and the separate browser suite.

Review the diff and surrounding callers for correctness, security, reliability,
accessibility and regression risk. Preserve exact count/order/duplicate
assertions when resolving conflicts; never weaken tests for merge convenience.
New behavior needs meaningful assertions; reuse existing browser coverage for
small changes when it already proves the behavior. Documentation-only edits do
not need invented app changes or new browser cases.

For a requested architectural/code review, report concrete findings with paths,
reproduction/evidence, impact and priority; separate verified bugs from design
tradeoffs and untested risks. Fix open-PR findings in that PR when within scope.
File only useful deferred work, deduplicating existing issues. Review is a
bounded task; do not start or re-arm monitoring unless requested. Inspect a
failed first CI run even when no comparison baseline exists. A mutation timeout
is a detected mutant, not proof the unmutated app hangs; diagnose the baseline,
runner and artifacts before assigning production severity.

## Delivery

1. Implement on the task branch, validate, review, commit and push on your own
   initiative. Unsigned commits are acceptable. Check machine Git hooks with
   `git config --show-origin --get core.hooksPath`; verify the remote rather than
   assuming auto-push.
2. Open a PR with a concise behavior/validation description and `Fixes #N` when
   it completes an issue. Present any still-unapproved substantive decision
   under Authorization before exercising that consequence.
3. Both required checks, `test` and `e2e`, must pass on the current PR head.
   `protect-main` blocks direct pushes. Queue an authorized PR with
   `gh pr merge --auto --squash`; use `--match-head-commit` when matching an
   inspected head. Watch CI and resolve failures on the same branch.
4. Merge to `main` triggers `.github/workflows/ci.yml`: test, build, migrations,
   deploy. Watch that run and verify the deployed commit at `/status`, plus the
   affected production behavior. A merged PR alone is not deployment evidence.

## Backlog and durable guidance

GitHub issues are the backlog, not README TODOs. Keep scope and acceptance in
the issue body; preserve user selections. Use a type label and relevant area
labels; see the small [issue conventions](.claude/skills/filing-issues/SKILL.md).

Skills are present-tense action guidance, not a changelog or roadmap. Keep
non-obvious constraints, remove obsolete advice, and place substantial recipes
in linked references. Update consequential guidance in the feature/fix PR.
Changing standing authorization follows the central Authorization section.
Do not use private harness memory as the repo's source of durable instructions.

`README.md` serves human readers and the public portfolio. Connor controls
substantive positioning and claims under Authorization. Mechanical corrections
and approved factual updates can share the relevant PR; do not manufacture a
separate README issue for every change or start unsolicited showcase work.

## Account facts

- Worker: `news`; Cloudflare account `dbaa50e60c18b19d483578c42d9bb3ee`.
- Zone: `cuteteal.com` (`1413a4570fa6e193d5f224ebb5220bb5`).
- Repo: `couetilc/news` (public; collaborators-only PRs, outside issues closed).
