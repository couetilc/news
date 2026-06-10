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
- **Tailwind CSS v4 via `@tailwindcss/vite`** (CSS-first config in
  `src/styles/global.css`, no `tailwind.config.js`; mobile-first,
  utility-first). Conventions and per-environment behavior:
  `.claude/skills/tailwind-css/SKILL.md`.
- **prettier** (with `prettier-plugin-astro` + `prettier-plugin-tailwindcss`
  for class ordering) is the repo formatter — run `npm run format` before
  committing.
- **node 24 via mise** (`mise.toml`); mise also injects `.env` into every shell
  run inside the project (`[env] _.file = ".env"`).
- **npm** for dependencies; `package-lock.json` is committed.
- Scaffold note: create-cloudflare (C3) crashed scaffolding Astro 6
  non-interactively (June 2026), so this was scaffolded with `create-astro` +
  `npx astro add cloudflare` — same end state.

## Commands

- `npm run dev` — dev server on workerd at http://localhost:4321
- `npm test` — vitest; **enforces 100% line and branch coverage over `src/**`\*\*
  (the suite fails below that — this is the standing test policy)
- `npm run build` — build worker + assets into `dist/`
- `npm run preview` — serve the built worker locally in workerd
- `npm run format` / `npm run format:check` — prettier over the whole repo
- `npm run deploy` — `astro build && wrangler deploy`
- `npm run cf-typegen` — regenerate `worker-configuration.d.ts` after any
  `wrangler.jsonc` change (commit the result)
- `npx wrangler tail` — stream production logs
- `npx wrangler secret put <KEY>` — set a production runtime secret
- `npx cf` — Cloudflare's unified CLI (technical preview) for inspecting
  production resources; inside `npx wrangler dev`, press `e` for the Local
  Explorer to browse local KV/D1/R2 state

## Credentials and secrets contract

- **`.env`** (gitignored) holds _tooling_ credentials — currently just
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

`npm test` must pass before any commit. `vitest.config.ts` deliberately does
NOT load `astro.config.mjs` (`configFile: false`) because the Cloudflare Vite
plugin is incompatible with vitest's node environment; components are rendered
in tests via the Container API (`astro/container`). If worker-runtime-specific
logic appears (bindings, Durable Objects), adopt `@cloudflare/vitest-pool-workers`
for those tests.

**Tests must never hit the network** — mock all external HTTP. This keeps
`npm test` hermetic so it passes in CI, in claude.ai cloud sessions under the
default Trusted network mode, and offline.

## Deploy flow

**Canonical: merge to main deploys.** Branch → PR → CI `test` job → merge →
CI `deploy` job (`.github/workflows/ci.yml`: build + `cloudflare/wrangler-action`
using the `CLOUDFLARE_API_TOKEN` repo secret). This works identically for
changes authored locally, via Dispatch, or in cloud sessions. Verify with
`gh run watch` and `curl -s https://news.cuteteal.com`.

**Direct pushes to `main` are blocked** by the `protect-main` repo ruleset —
always work on a branch and open a PR; the `test` check must be green to
merge. Queue merges with `gh pr merge --auto --squash` (auto-merge is enabled
repo-wide). Cloud sessions cannot open PRs themselves (no gh, no API
credential): end those by pushing the branch and stating that the PR should be
created from the session UI or by a credentialed session.

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
- GitHub repo: `couetilc/news` (private)
