# CLAUDE.md

## What this is

A personal, single-user news aggregator for Connor (GitHub: couetilc), served at
https://news.cuteteal.com on Cloudflare Workers. Currently a hello-world Astro
skeleton; every change should move it toward being a useful news aggregator.

## Stack and architectural decisions

- **Astro 6 with `output: 'server'`** — all pages SSR by default (an aggregator
  serves fresh content). Opt individual pages back into prerendering with
  `export const prerender = true`.
- **`@astrojs/cloudflare` adapter v13**, built on `@cloudflare/vite-plugin`:
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
- **node 24 via mise** (`mise.toml`) on host machines; mise also injects
  `.env` into every shell run inside the project (`[env] _.file = ".env"`).
  Surface qualifier: the agent container bakes node into its image and gets
  env vars via `docker --env-file`; the cloud VM uses its stock node and has
  no `.env` at all — neither has mise, so skip mise commands there.
- **npm** for dependencies; `package-lock.json` is committed. Adding a dependency
  follows a **middle-path policy + an agent propose-for-approval mechanism** —
  don't roll your own crypto, don't add deps unilaterally; see the `dependencies`
  skill.
- Scaffold note: create-cloudflare (C3) crashed scaffolding Astro 6
  non-interactively (June 2026), so this was scaffolded with `create-astro` +
  `npx astro add cloudflare` — same end state.

## Commands

- `npm run dev` — dev server on workerd at http://localhost:4321 (inside the
  agent container run `npm run dev -- --host` and visit `$DEV_HOST_4321`, since
  the host port is randomized per container — see the agentic-environments skill)
- `npm test` — vitest; **enforces 100% statements / branches / functions / lines coverage over `src/**`**
  (the suite fails below that — this is the standing test policy)
- `npm run test:e2e` — Playwright browser tests (`playwright test`), a
  **separate** entry point kept out of `npm test` and the coverage gate (it
  loads the real dev server). The agent container bakes in a headless Chromium
  shell so this and the `verify`/`run` skills can drive the local app in a real
  browser. **Launch Chromium with `--no-sandbox`** (`chromium.launch({ args:
  ['--no-sandbox'] })`) — non-root Chromium in the container can't use the
  sandbox; it's a throwaway container so that's fine. The baked browser lives at
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`; its version is pinned in lockstep
  with the `@playwright/test` devDependency (bump both together). Outside the
  container (host/cloud) run `npx playwright install chromium` first. See the
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
- `./bin/claude` — run Claude Code full-auto inside an isolated agent
  container (Docker; clones the repo fresh from GitHub, so nothing from the
  host is mounted and parallel containers don't conflict; tokens injected
  from `.env`); see `.claude/skills/agentic-environments/SKILL.md`

## Credentials and secrets contract

- **`.env`** (gitignored) holds *tooling* credentials — currently just
  `CLOUDFLARE_API_TOKEN` (wrangler reads `.env` natively; mise injects it for
  everything else). **`.env.example` is the living documentation** for each
  token — purpose, regeneration steps, and exact scopes. Convention: any change
  to a token's required scope updates those comments in the same commit.
- **Worker runtime secrets** never go in `.env`: use `.dev.vars` locally and
  `npx wrangler secret put` for production.
- **GitHub auth needs no token**: local and Dispatch sessions push over SSH /
  gh keyring; claude.ai cloud sessions get a scoped credential through the
  Claude GitHub App proxy; CI uses the built-in `GITHUB_TOKEN`. (See
  `.env.example` for the fallback if a constrained local-agent flow is ever
  needed.)
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
  `ON CONFLICT` semantics (all `src/ingest/**`, the worker's real D1 behavior);
  `node` (`vitest.node.config.ts`) renders `.astro` pages via Astro's Container
  API and hosts the `src/worker.ts` entry test. Every `src/**` file is exercised
  by exactly one project.
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
4. `gh pr create --fill`
5. `gh pr merge --auto --squash <num>` — merges itself once the required
   `test` check passes. **Ordinary PRs only** — human-gated PRs are presented
   for the human to merge, not auto-merged (see Deploy flow for which classes).
6. Watch CI: `gh run list --branch <topic>` then `gh run watch <run-id>`
   (`gh run view <run-id> --log` for failure logs). On a red check, fix and
   commit again — the push updates the same PR. (`gh pr checks` needs an
   extra PAT scope in containers; the gh run commands always work.)
7. After merge: `curl -s https://news.cuteteal.com` to verify the deploy.

## Deploy flow

**Canonical: merge to main deploys.** Branch → PR → CI `test` job → merge →
CI `deploy` job (`.github/workflows/ci.yml`: build + `cloudflare/wrangler-action`
using the `CLOUDFLARE_API_TOKEN` repo secret). This works identically for
changes authored locally, via Dispatch, or in cloud sessions. Verify with
`gh run watch` and `curl -s https://news.cuteteal.com`.

**Direct pushes to `main` are blocked** by the `protect-main` repo ruleset —
always work on a branch and open a PR; the `test` check must be green to
merge. Queue ordinary merges with `gh pr merge --auto --squash` (auto-merge is
enabled repo-wide). **Human-gated PRs are the exception** — leave them for the
human to review and merge rather than queueing auto-merge: skill updates (Skills
& memory policy), dependency adds (the `dependencies` skill), README changes
(README policy), and `.github/workflows/*` / `docker/**` changes (explicit human
go-ahead).

Manual fallback: `npm run deploy` from a machine with `.env` or wrangler OAuth
(never from cloud sessions — `api.cloudflare.com` isn't reachable there under
Trusted network mode). Workflow-file edits should be made locally/Dispatch:
cloud sessions' scoped git credential may not be allowed to push
`.github/workflows/*` changes.

The custom domain `news.cuteteal.com` and the auto-provisioned `SESSION` KV
namespace are managed declaratively by `wrangler.jsonc` on each deploy; the
worker is also reachable at its `*.workers.dev` URL (left enabled).

## Account facts

- Cloudflare account: `dbaa50e60c18b19d483578c42d9bb3ee` (connor@couetil.com)
- Zone: `cuteteal.com` (`1413a4570fa6e193d5f224ebb5220bb5`)
- GitHub repo: `couetilc/news` (public — PRs restricted to collaborators, outside issues auto-closed)
