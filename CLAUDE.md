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
- **npm** for dependencies; `package-lock.json` is committed.
- Scaffold note: create-cloudflare (C3) crashed scaffolding Astro 6
  non-interactively (June 2026), so this was scaffolded with `create-astro` +
  `npx astro add cloudflare` — same end state.

## Commands

- `npm run dev` — dev server on workerd at http://localhost:4321 (inside the
  agent container run `npm run dev -- --host` and visit `$DEV_HOST_4321`, since
  the host port is randomized per container — see the agentic-environments skill)
- `npm test` — vitest; **enforces 100% line and branch coverage over `src/**`**
  (the suite fails below that — this is the standing test policy)
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

`npm test` must pass before any commit. The suite runs as **two vitest projects**
(`vitest.config.ts` wires them together and owns the merged coverage gate):

- **`workers`** (`vitest.workers.config.ts`) — runs inside workerd via
  `@cloudflare/vitest-pool-workers`, so `cloudflare:workers` env, D1 bindings, and
  `ON CONFLICT` semantics behave exactly as in production. A real local D1 is
  declared inline (`miniflare.d1Databases`) and the committed `migrations/*.sql`
  are applied per test file by `test/helpers/apply-migrations.ts` (the
  `applyD1Migrations` helper from `cloudflare:test`). All `src/ingest/**` is
  tested here. The worker entry's real D1 behavior is covered here too (via
  `run.test.ts` / `db.test.ts`), but the trivial `src/worker.ts` wiring test
  lives in the `node` project — see below.
- **`node`** (`vitest.node.config.ts`) — node environment for the two things
  better hosted outside the worker pool: rendering `.astro` pages via Astro's
  Container API (Astro's Vite plugins pull in `xxhash-wasm`, which the worker
  pool can't load), and the `src/worker.ts` entry test. `worker.ts`'s only
  workerd-specific imports (`@astrojs/cloudflare/handler` and the ingest run)
  are `vi.mock`ed and its DB is an opaque pass-through, so it needs no real
  workerd — and running it under node keeps Istanbul's coverage for the async
  `scheduled` handler deterministic. Under the worker pool that coverage was
  intermittently dropped, red-failing the 100% gate at random (#37). Both
  project configs keep `configFile: false` (the Cloudflare adapter's Vite plugin
  is incompatible with the test pipeline). Pages import `cloudflare:workers`,
  which doesn't exist outside workerd, so it's aliased to
  `test/helpers/cloudflare-workers.ts`; a page's data access is mocked and its
  real D1 behavior is covered by the `workers` project.

Coverage is **Istanbul, not V8** (workerd has no `node:inspector`); the 100%
line/branch gate over `src/**` holds across the merged projects, so every src
file must be exercised by one project or the other.

**Tests must never hit the network** — inject `fetch` (the ingest runner takes a
`fetchFn`) and use feed fixtures under `test/fixtures/`. This keeps `npm test`
hermetic so it passes in CI, in claude.ai cloud sessions under the default
Trusted network mode, and offline.

## Backlog

The backlog lives in **GitHub issues** (`gh issue list`, `gh issue view`),
not in README TODOs or this file. When work is requested or discovered but
not done now, file an issue (`gh issue create`); close issues from PRs with
"Fixes #N" in the PR body.

## Memory policy

Don't use the harness's file-based memory feature (`~/.claude/projects/.../memory/`)
— it doesn't survive the agent container and is invisible to other surfaces.
Roll durable learnings into this CLAUDE.md or the appropriate skill under
`.claude/skills/`, shipped in your PR like any other change.

## Standard dev loop

The convention on every surface (local, Dispatch, agent container, cloud):

1. `git checkout -b <topic>` — never work on `main`.
2. Implement; keep `npm test` green (100% line/branch coverage gate).
3. Commit and push frequently, on your own initiative — small commits, never
   wait to be asked (this overrides the harness default of committing only on
   request).
4. `gh pr create --fill`
5. `gh pr merge --auto --squash <num>` — merges itself once the required
   `test` check passes.
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
merge. Queue merges with `gh pr merge --auto --squash` (auto-merge is enabled
repo-wide).

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
