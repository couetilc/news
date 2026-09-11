# CLAUDE.md

## What this is

A personal, single-user news aggregator for Connor (GitHub: couetilc), served at
https://news.cuteteal.com on Cloudflare Workers. It ingests feeds into D1 and
serves a per-user read/unread digest behind email+password auth (public
read-only feed for anonymous visitors); keep moving it toward a more capable
aggregator.

## Stack and architectural decisions

- **Astro 7 with `output: 'server'`** — all pages SSR by default (an aggregator
  serves fresh content). Opt individual pages back into prerendering with
  `export const prerender = true`.
- **`@astrojs/cloudflare` adapter v14**, built on `@cloudflare/vite-plugin`:
  `astro dev` runs the app **inside workerd** locally with real local bindings —
  this is the rapid-iteration loop. `astro build` emits the worker to
  `dist/server/` plus a deployable config at `dist/server/wrangler.json`;
  running `wrangler deploy` from the repo root auto-resolves that emitted config.
- **`imageService: 'compile'`** — build-time image optimization only, no
  Cloudflare Images billing dependency. Switch to `'cloudflare-binding'` if we
  ever transform external article images at runtime.
- **Sessions**: the adapter auto-configures Astro Sessions on a KV namespace
  bound as `SESSION`, auto-provisioned at first deploy.
- **`wrangler.jsonc` is the single infra config**: `account_id`, the custom
  domain route `news.cuteteal.com` (DNS record + certificate are auto-managed by
  Cloudflare), `nodejs_compat`. Declare future D1/R2/KV resources here — and
  update the token-scope comments in `.env.example` in the same commit.
- **node 24** is the working pin: `package.json` `engines` sets the floor
  (`>=22.12.0`), and each surface provisions node independently — the agent
  container bakes `node:24-slim` into its image, CI pins node 24 via
  `actions/setup-node`, and the cloud VM's stock node 22 satisfies `engines`.
  On host machines install node 24 with your version manager of choice (e.g.
  `nvm install 24`). Env vars: `wrangler` reads `.env` natively, and the agent
  container injects it via `docker --env-file`; the cloud VM has no `.env`.
- **npm** for dependencies; `package-lock.json` is committed. Adding a dependency
  follows a **middle-path policy + an agent propose-for-approval mechanism** —
  don't roll your own crypto, don't add deps unilaterally; see the `dependencies`
  skill.

## Native laptop setup (default)

Use the installed Codex or Claude CLI/desktop app directly. `.envrc` leaves
PATH unchanged; `codex` and `claude` must not resolve under `.agent/bin`.
Docker and cloud sessions are optional; their setup does not apply to native
work. After updating an already direnv-enabled checkout, run `direnv allow`
and let the shell reload the changed entry.

1. Use Node 24 and create a topic branch (`git checkout -b <topic>`). For
   concurrent agents, fetch origin and use a separate
   `git worktree add -b <topic> <path> origin/main` per task; run the remaining
   commands from that worktree.
2. Run `npm ci`, `npm run db:migrate:local`, then
   `npx playwright install chromium`. Each worktree owns its dependencies,
   build output and local D1/KV state. The SessionStart hook does **not**
   bootstrap native sessions.
3. Put local runtime secrets in ignored `.dev.vars`; use a freshly generated,
   local-only `AUTH_PEPPER` for local auth/build preview. Do not copy production
   secrets or another worktree's sessions. Tooling credentials, when needed,
   belong in ignored `.env` or the tool's existing login/keyring.
4. Run `npm run dev -- --host 127.0.0.1` and use the printed address. Give each
   concurrent dev server its own `--port`; preserve servers owned by other
   tasks. `npm run test:e2e` owns a separate build, state directory and port.
5. Follow the Standard dev loop below: PR → required `test` **and** `e2e`
   checks → merge → CI deploy. See the `agentic-environments` skill for
   credential checks and optional surfaces.

## Commands

- `npm run dev` — dev server on workerd at http://localhost:4321 (inside the
  agent container run `npm run dev -- --host` and visit `$DEV_HOST_ASTRO`, since
  the host port is randomized per container — see the agentic-environments skill)
- `npm test` — vitest; **enforces 100% statements / branches / functions / lines coverage over `src/**`**
  (the suite fails below that — this is the standing test policy)
- `npm run test:e2e` — isolated Playwright browser tests (`node e2e/run.mjs`), a
  **separate** entry point kept out of `npm test` and the coverage gate (it
  builds the real app into a fresh test root and starts workerd on an owned
  loopback port). Test D1/KV state, build artifacts and runtime vars are isolated
  from development; import `test` from `e2e/fixtures.ts` and seed in `beforeEach`. The agent container bakes in a headless Chromium
  shell so this and the `verify`/`run` skills can drive the local app in a real
  browser. **Launch Chromium with `--no-sandbox`** (`chromium.launch({ args:
  ['--no-sandbox'] })`) — non-root Chromium in the container can't use the
  sandbox; it's a throwaway container so that's fine. The baked browser lives at
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`; its version is pinned in lockstep
  with the `@playwright/test` devDependency (bump both together). Outside the
  container, on a host run `npx playwright install chromium` first; in claude.ai
  cloud sessions that can't work (browser CDN egress-blocked, VM's preinstalled
  build lags the pin) — run `scripts/pw-browser-shim.sh` there instead. See the
  `agentic-environments` skill.
- `npm run build` — build worker + assets into `dist/`
- `npm run preview` — serve the built worker locally in workerd
- `npm run deploy` — `astro build && wrangler deploy`
- `npm run cf-typegen` — regenerate `worker-configuration.d.ts` after any
  `wrangler.jsonc` change (commit the result)
- `npx wrangler tail` — stream production logs
- `npx wrangler secret put <KEY>` — set a production runtime secret
- `npx cf` — Cloudflare's unified CLI (technical preview) for inspecting
  production resources; inside `npx wrangler dev`, press `e` for the Local
  Explorer to browse local KV/D1/R2 state
- `./.agent/bin/agent claude` / `./.agent/bin/agent codex` — optionally run
  Claude Code / Codex full-auto inside an
  isolated agent container via the published `@couetilc/agentic-coding` tool
  (configured in `.agent/`; Docker; clones the repo fresh from GitHub, so
  nothing from the host is mounted and parallel containers don't conflict;
  project tokens from `.env`, host agent credentials from
  `~/.config/agentic-coding/env`); see `.claude/skills/agentic-environments/SKILL.md`
  and `.agent/README.md`

## Optional agent container surface

When you explicitly launch the `./.agent/bin/agent claude` /
`./.agent/bin/agent codex` container (a disposable,
non-root Docker container that clones this repo fresh — nothing from the host is
mounted): you begin on a fresh clone of `main`, so **branch before committing**,
and **commit + push early and often** — work leaves only via `git push` (commits
are gitleaks-gated then auto-pushed by hooks baked into the image), and nothing
else survives the container. Changes reach production only via PR → CI → merge.
The backlog is GitHub issues (`gh issue list` — see Backlog below).

Baked toolchain: node 24 (matches the repo pin), npm, git, gh, gitleaks,
ripgrep (`rg`), and uv from the `@couetilc/agentic-coding` base image; plus
shellcheck, actionlint, and a headless Chromium/Playwright shell from this
repo's `.agent/Dockerfile` overlay. You run as **non-root**, so `apt install`
is impossible mid-session: for a one-off need use a user-space install (`npx`,
a devDependency, a binary in `~/.local/bin`); when a tool is needed *again*,
open a GitHub issue proposing it be added to `.agent/Dockerfile` (human-gated)
rather than editing the image this session. Cross-surface specifics — host-port
mapping via `$DEV_HOST_ASTRO` / `$DEV_HOST_WRANGLER`, work recovery, credential
injection — live in the `agentic-environments` skill and `.agent/README.md`.

## Credentials and secrets contract

- **`.env`** (gitignored) holds *tooling* credentials — currently just
  `CLOUDFLARE_API_TOKEN` (wrangler reads `.env` natively). **`.env.example` is
  the living documentation** for each
  token — purpose, regeneration steps, and exact scopes. Convention: any change
  to a token's required scope updates those comments in the same commit.
- **Worker runtime secrets** never go in `.env`: use `.dev.vars` locally and
  `npx wrangler secret put` for production.
- **Native GitHub auth needs no extra `GH_TOKEN` when the existing login
  works.** Check `git remote get-url origin` and `gh auth status`: HTTPS may
  use the gh keyring, while SSH needs a working key. Do not infer transport or
  workflow-file permission from running locally. Cloud sessions use the
  Claude GitHub App proxy; CI uses the built-in `GITHUB_TOKEN`. See
  `.env.example` for the optional container credential.
- The Cloudflare token lives in exactly two places: local `.env` and the
  GitHub Actions repo secret `CLOUDFLARE_API_TOKEN`. The claude.ai cloud
  environment is **deliberately credential-free** — cloud sessions test and
  push branches; CI deploys. On Connor's machine, `npx wrangler login`
  (OAuth) also works instead of the token.
- Execution surfaces differ in important ways (Dispatch runs locally on
  Connor's Mac; cloud sessions run in a sandboxed VM and can only push their
  own branch): see the skill at
  `.claude/skills/agentic-environments/SKILL.md` before configuring or
  debugging any of them.

## Testing policy

Load-bearing essentials (the full detail — project-split rationale, the
assert-don't-just-cover principle, when a change needs a unit vs an e2e test, the
branch-gate caveat, and the parser-robustness contract — lives in the `testing`
skill at `.claude/skills/testing/SKILL.md`):

- **`npm test` must pass before any commit**, at **100% Istanbul statements /
  branches / functions / lines over `src/**`** (the standing floor; merged across
  both projects in `vitest.config.ts`). Istanbul, not V8 — workerd has no
  `node:inspector`.
- **Two vitest projects, because two runtimes are required:** `workers`
  (`vitest.workers.config.ts`) runs inside workerd via
  `@cloudflare/vitest-pool-workers` for real `cloudflare:workers` env + D1 +
  `ON CONFLICT` semantics (the imperative shell: D1 data layer, ingest
  orchestration, endpoints, workerd crypto); `node` (`vitest.node.config.ts`)
  hosts every pure functional-core spec (parsers, normalization, the
  schedule/merge/queries/digest cores), renders `.astro` pages via Astro's
  Container API, and runs the `src/worker.ts` entry test. Every `src/**` file's
  dedicated spec lives in exactly one project.
- **Hermetic — tests must never hit the network.** Inject `fetch` (the ingest
  runner takes a `fetchFn`) and use feed fixtures under `test/fixtures/`. Keeps
  `npm test` green in CI, in claude.ai cloud sessions (Trusted network mode), and
  offline.
- **Coverage is the floor, not proof of correctness.** A covered line isn't an
  asserted one — assert observable behavior and the edges, never just execute
  (see the `testing` skill).
- **Browser/e2e (`npm run test:e2e`, Playwright) is deliberately outside this
  contract** — own entry point, not in `npm test`, not in the coverage gate; for
  full-browser behavior the hermetic pools can't exercise.

## Backlog

The backlog lives in **GitHub issues** (`gh issue list`), not in README TODOs or
this file. File an issue when work is requested or discovered but not done now;
close it from a PR with "Fixes #N". Issues carry a *type* label
(bug/enhancement/documentation) and a loose, evolving *area* label you can steer
work with — e.g. `gh issue list --label testing` (current set: `gh label list`).
Filing/structure conventions, the area-label taxonomy, and sub-issues-as-epics
live in the `filing-issues` skill.

## README policy

`README.md` is the project's **public-image / portfolio surface**, not just a dev
quickstart — it serves a human audience (recruiters, collaborators, curious devs)
alongside the developer one. Two standing rules:

- **Items of interest to a human reader belong in the README**, not only in this
  agent-oriented `CLAUDE.md`. When a change or discovery would help someone
  reading/using/contributing to the repo — or is worth showcasing — surface it in
  `README.md`.
- **⚠️ Every `README.md` change requires Connor's sign-off before it lands.** No
  agent or PR modifies `README.md` without first showing Connor the proposed
  change for approval: draft → show the human → only then apply/commit/merge.
- **Agent-driven README updates go in their own issue, never bundled into a
  feature PR.** When an agent implementing a feature notices a worthwhile README
  improvement, it must *not* stall that feature on the README approval gate —
  file a separate, self-contained GitHub issue for the README change and keep the
  feature moving. The README work then runs its own draft → sign-off cycle,
  asynchronously, so the human gate never blocks the delivery pipeline.

## Skills & memory policy

Skills (`.claude/skills/`) are **action-guidance**: present-tense advice an agent
acts on *now* — not a changelog, not a roadmap. Keep history out unless it's
consequential rationale (state it as fact, not story); keep future/aspirational
work in GitHub issues, not the skill.

- **Propose a skill update when you learn something durable and consequential** —
  a confirmed constraint, a gotcha, a better pattern future agents would miss — or
  when a skill has gone stale or its roadmap item has shipped. Not for trivia or
  what the repo already records.
- **Human-gated**: a skill steers every future agent, so surface the change (a PR
  to edit; an issue for a bigger rethink) for review — never a silent rewrite.
- **A new capability lands in its skill when it's implemented**: the issue that
  implements it carries the guidance to add; until then the advice lives in the
  issue, not the skill.

Don't use the harness's file-based memory feature (`~/.claude/projects/.../memory/`)
— it doesn't survive the agent container and is invisible to other surfaces.
Durable learnings ship as a CLAUDE.md or skill PR like any other change (per the
above).

## Standard dev loop

The convention on every surface (local, Dispatch, agent container, cloud):

1. `git checkout -b <topic>` — never work on `main`.
2. Implement; keep `npm test` green (100% statements / branches / functions / lines coverage gate).
3. Commit and push frequently, on your own initiative — small commits, never
   wait to be asked (this overrides the harness default of committing only on
   request).
   Local Git hooks are machine configuration, not installed by a fresh clone.
   Check `git config --show-origin --get core.hooksPath`; do not assume a
   commit auto-pushed. Push explicitly and verify the remote branch.
4. `gh pr create --fill`
5. `gh pr merge --auto --squash <num>` — merges itself once the required
   `test` and `e2e` checks pass. **Ordinary PRs only** — human-gated PRs are presented
   for the human to merge, not auto-merged (see Deploy flow for which classes).
6. Watch CI: `gh run list --branch <topic>` then `gh run watch <run-id>`
   (`gh run view <run-id> --log` for failure logs). On a red check, fix and
   commit again — the push updates the same PR. (`gh pr checks` needs an
   extra PAT scope in containers; the gh run commands always work.)
7. After merge: `curl -s https://news.cuteteal.com` to verify the deploy.

## Deploy flow

**Canonical: merge to main deploys.** Branch → PR → CI `test` + `e2e` jobs → merge →
CI `deploy` job (`.github/workflows/ci.yml`: build + `cloudflare/wrangler-action`
using the `CLOUDFLARE_API_TOKEN` repo secret). This works identically for
changes authored locally, via Dispatch, or in cloud sessions. Verify with
`gh run watch` and `curl -s https://news.cuteteal.com`.

**Direct pushes to `main` are blocked** by the `protect-main` repo ruleset —
always work on a branch and open a PR; both `test` and `e2e` must be green to
merge. Queue ordinary merges with `gh pr merge --auto --squash` (auto-merge is
enabled repo-wide). **Human-gated PRs are the exception** — leave them for the
human to review and merge rather than queueing auto-merge: skill updates (Skills
& memory policy), dependency adds (the `dependencies` skill), README changes
(README policy), and `.github/workflows/*` / `.agent/**`
container-config changes (explicit human go-ahead).

Manual fallback: `npm run deploy` from a machine with `.env` or wrangler OAuth
(never from cloud sessions — `api.cloudflare.com` isn't reachable there under
Trusted network mode). Workflow-file pushes need a credential with workflow
permission (OAuth/classic PAT `workflow`, or fine-grained Workflows write),
including on a laptop. An ordinary successful push does not prove that access;
check the available credential or connected GitHub integration before changing
`.github/workflows/*`. Do not print tokens when checking capabilities.

The custom domain `news.cuteteal.com` and the auto-provisioned `SESSION` KV
namespace are managed declaratively by `wrangler.jsonc` on each deploy; the
worker is also reachable at its `*.workers.dev` URL (left enabled).

## Account facts

- Cloudflare account: `dbaa50e60c18b19d483578c42d9bb3ee` (connor@couetil.com)
- Zone: `cuteteal.com` (`1413a4570fa6e193d5f224ebb5220bb5`)
- GitHub repo: `couetilc/news` (public — PRs restricted to collaborators, outside issues auto-closed)
