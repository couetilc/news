---
name: Agentic dev environments
description: How Claude sessions run against this repo across all four surfaces — local CLI/desktop, Claude Dispatch, claude.ai cloud sessions, and GitHub Actions — including credentials, cloud environment configuration, setup scripts vs SessionStart hooks, network access modes, and deploy paths.
when_to_use: Configuring or debugging any Claude execution surface for this repo; deploy failures in CI or from an agent session; questions about which credentials/tokens exist where; setting up the claude.ai cloud environment or Dispatch; deciding network access modes; onboarding a new agent surface; verifying an environment works (test plan).
---

# Agentic dev environments for this repo

This repo (`couetilc/news` → https://news.cuteteal.com) is developed by Claude
sessions on four surfaces. Each has a different execution context, credential
set, and set of allowed actions. This skill is the source of truth for those
differences.

## Execution contexts

| Surface | Where code runs | Triggered from | Repo access | Can deploy? |
|---|---|---|---|---|
| Local CLI / desktop app | Connor's Mac, `~/repos/news` | Terminal / Code tab | Working tree, SSH push | Yes (manual fallback) |
| **Dispatch** | **Connor's Mac** (desktop app must be running & awake) | Phone / Cowork tab | Same local working tree, SSH push | Yes (same as local) |
| Cloud sessions (claude.ai/code, `claude --remote`) | Anthropic-managed Ubuntu 24.04 VM (4 vCPU / 16 GB / 30 GB) | Web, mobile, CLI | Fresh clone via GitHub App proxy; **push restricted to the session's own branch**; changes land via PR | **No** (by design) |
| Agent container (`./bin/claude`) | Docker on Connor's Mac, full-auto (`--dangerously-skip-permissions`) | Terminal | Fresh clone from GitHub into container-private `/workspace`; HTTPS push via `GH_TOKEN` | Possible but discouraged — use PRs |
| GitHub Actions | GitHub-hosted runner | Push / PR events | `actions/checkout` | **Yes — the canonical deploy path** |

Key facts:

- **Dispatch is NOT cloud execution.** It is remote *triggering* of a local
  session. If the Mac is asleep or the desktop app closed, Dispatch tasks
  cannot run. Dispatch sessions inherit everything local: mise (node 24),
  `.env` (auto-injected by mise), wrangler OAuth/token, SSH keys, gh keyring.
- **Cloud sessions are sandboxed.** The git client holds only a scoped
  credential; a GitHub proxy translates it outside the sandbox and restricts
  pushes to the current working branch. Sessions persist after you close the
  browser; hand off with `claude --teleport <session-id>` (cloud → terminal)
  or `claude --remote "task"` (terminal → cloud).

## Credentials matrix

`.env.example` is the living documentation for token scopes. Current state:

| Surface | Cloudflare | GitHub |
|---|---|---|
| Local + Dispatch | `CLOUDFLARE_API_TOKEN` in `.env` (or `npx wrangler login` OAuth) | SSH key + gh keyring |
| Cloud sessions | **None — deliberately credential-free** | Scoped credential via GitHub App proxy (automatic) |
| GitHub Actions | Repo Actions secret `CLOUDFLARE_API_TOKEN` (same token value as `.env`) | Built-in `GITHUB_TOKEN` |

Decisions behind this (June 2026): deploys happen in CI after merge, so cloud
sessions need no Cloudflare token and no network exception; the claude.ai
environment has no dedicated secrets store (env vars are visible to anyone who
can edit the environment), so keeping it empty is the safest default.

## Cloud environment recipe (claude.ai settings)

The environment for this repo should be configured as:

- **Network access:** Trusted (default)
- **Environment variables:** none
- **Setup script:** none

No setup script is needed because the VM preinstalls Node 20/21/22 via nvm and
stock Node 22 satisfies our `engines` requirement (>=22.12.0); `npm ci` is
handled by the repo's SessionStart hook (below). mise is NOT preinstalled in
the VM and is not needed there.

If Node version drift ever breaks the build in cloud sessions, paste this as
the environment's setup script:

```bash
#!/bin/bash
# Best-effort: align cloud Node with mise.toml's pin; never block the session.
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm install 24 || true
```

Setup-script mechanics (why it behaves unlike a normal script):

- Configured in the claude.ai environment settings dialog — NOT a file in this
  repo. Keep the canonical text here and paste it into the UI.
- Runs as **root** on the VM **before Claude Code launches**.
- Runs only when no cached snapshot exists: after the first successful run the
  filesystem is snapshotted and reused, so later sessions skip it. It re-runs
  when the script or allowed network hosts change, or after ~7-day cache expiry.
- Budget ~5 minutes; a non-zero exit fails the whole session (append `|| true`
  to non-critical commands).

## SessionStart hook (repo-committed bootstrap)

`.claude/settings.json` registers a SessionStart hook running
`scripts/session-start.sh` on every session start/resume, on every surface.
The script exits immediately unless `CLAUDE_CODE_REMOTE=true` (set only in
cloud sessions), where it runs `npm ci` so the fresh clone has dependencies.

Division of labor per official docs: tools/runtimes the VM lacks → setup
script (cached snapshot); project dependency install → SessionStart hook
(runs every session, repo-versioned).

## Agent container (`./bin/claude`)

Local full-auto surface: runs `claude --dangerously-skip-permissions` inside
Docker. `docker/Dockerfile` codifies the toolchain (node:24-slim matching
mise.toml's pin, git, gh, gitleaks version-matched to the host, claude CLI,
non-root `node` user — required because `--dangerously-skip-permissions`
refuses to run as root).

- **Nothing from the host is mounted**: the entrypoint clones the repo fresh
  from GitHub at launch (`GH_TOKEN`, HTTPS) into the container-private
  `/workspace`. Parallel containers share nothing (but an npm cache volume),
  and the host filesystem is unreachable — **work enters via the remote and
  leaves only via git**: each commit is gitleaks-gated
  (`.git-hooks/pre-commit`) then auto-pushed (`.git-hooks/post-commit`),
  landing as a branch for the normal PR → CI → merge flow. Consequence: a
  container starts from origin's state, so hand it in-progress work by
  committing first (auto-push publishes the branch), then have the session
  check out that branch.
- `./bin/claude [args]` → builds the image if needed and runs claude
  full-auto; `--shell` drops into bash; `--clean` removes exited agent
  containers AND rebuilds the image from scratch (`--pull --no-cache`) so the
  baked-in claude CLI doesn't freeze at image-build-time latest. Containers
  are **kept after exit** so unpushed work is recoverable (`docker start -ai
  <name>` — note this starts a NEW claude session in the old workspace; use
  `/resume` inside to pick up the prior one; `docker cp` to salvage files).
- **First-run UX + surface identity**: the entrypoint pre-seeds
  `~/.claude.json` (onboarding + bypass-permissions + /workspace trust
  accepted) so sessions drop straight in authenticated by
  `CLAUDE_CODE_OAUTH_TOKEN`, and writes a container-scoped
  `~/.claude/CLAUDE.md` telling each session it's in this container (no
  mise, PR-only path to prod, backlog = gh issues).
- **Model quirk under setup-token auth**: the session bills the Max
  subscription ("inference-only" limits capability scope, not billing), but
  entitlement metadata under-reports — the /model picker omits Fable and
  `best` falls back to Opus. Explicit ids work fine, so the entrypoint seeds
  `~/.claude/settings.json` with the current top model id (verified
  empirically 2026-06; update the id in `docker/entrypoint.sh` when a newer
  model ships). Default effort is **xhigh** (`--effort` on the invocation +
  settings seed).
- **CLI freshness**: claude is installed via the native installer under
  `~/.local` (node-owned), and the entrypoint runs `claude update` before
  every session start; mid-session auto-update stays disabled for
  predictability. `--clean` rebuilds still refresh the base image (node,
  gh, gitleaks).
- **Future gap, noted**: `.dev.vars` (Worker runtime secrets for local dev)
  is gitignored, so container clones won't have it. When the app gains feed
  API keys, decide a distribution path (e.g. inject via `.env` →
  entrypoint-written `.dev.vars`, or accept that runtime-secret dev happens
  on the host).
- **Env injection**: the wrapper passes `--env-file .env` — the container
  authenticates with `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`;
  Keychain isn't mountable), pushes with `GH_TOKEN` (SSH remote is rewritten
  to HTTPS in the container; no SSH keys inside), and holds
  `CLOUDFLARE_API_TOKEN` for ad-hoc wrangler use. See `.env.example`.
- `npm ci` runs into the container's own filesystem (host darwin-arm64
  binaries like workerd can't run on Linux); the shared `news-agent-npm-cache`
  volume keeps repeat installs fast. Dev ports (4321, 8787) are published to
  random localhost ports — find them with `docker port <name>`.
- **Isolation contract, honestly stated**: protects the host filesystem,
  Keychain, SSH keys, and other repos. It does NOT protect the tokens
  injected from `.env` (readable as env vars by anything in the container)
  and has unrestricted network egress. For
  egress restriction, adapt Anthropic's reference firewall:
  https://github.com/anthropics/claude-code/tree/main/.devcontainer
  (init-firewall.sh; needs NET_ADMIN/NET_RAW). Only use with trusted repo
  content. A lighter alternative for fewer prompts without skipping checks is
  permission "auto mode" (classifier-reviewed).
- **Auto-push on commit**: the repo-versioned, self-contained hooks in
  `.git-hooks/` (see its README) are wired automatically by the container
  entrypoint and the cloud SessionStart hook; Connor's machine has equivalent
  global hooks (repo hooks are opt-in there). Branch commits push themselves —
  `main` is skipped (ruleset blocks it). In the clone-per-container model this
  is the data path: an unpushed commit exists only inside that container.

## Network access (cloud sessions)

Modes: **None** / **Trusted** (allowlisted package registries, GitHub, some
cloud SDKs) / **Full** (any domain) / **Custom** (your allowlist, optionally
plus the Trusted defaults). All egress passes through Anthropic's security
proxy; GitHub traffic uses its own separate proxy regardless of mode.

Facts that drove our choices:

- `api.cloudflare.com` is **not** in the Trusted allowlist → `wrangler deploy`
  fails from a Trusted cloud session. That's fine: deploys belong to CI.
- **Testing policy: vitest must never hit the network.** Mock all external
  HTTP. This keeps `npm test` working under Trusted, in CI, and offline.
- Future: when feature work needs to fetch live feeds/APIs *during cloud
  development*, switch the environment to **Custom**, list the feed domains
  (one per line, `*.` wildcards supported), and check "Also include default
  list of common package managers". Until then, develop live-fetch features
  locally or via Dispatch. Changing network settings invalidates the
  environment cache (setup script re-runs).

## Deploy paths

1. **Canonical:** branch → PR → CI `test` job (100% coverage gate) → merge to
   `main` → CI `deploy` job (`npm run build` + `cloudflare/wrangler-action`).
   Works identically for changes authored locally, via Dispatch, or in cloud
   sessions.
2. **Manual fallback:** `npm run deploy` from a machine with `.env` or
   wrangler OAuth (local/Dispatch only).
3. Cloud sessions never deploy directly.

Two behaviors verified empirically (2026-06-10):

- **Cloud sessions cannot open PRs.** The sandbox has no `gh` CLI and no
  GitHub API credential — its scoped git credential only clones, fetches, and
  pushes the session branch. A cloud session's job ends at "branch pushed";
  the PR is then created either from the session UI on claude.ai (Create PR
  button) or by any credentialed session (`gh pr create --head <branch>`).
  This is platform design, not a prompt/config gap.
- **Direct pushes to `main` are mechanically blocked** since 2026-06-10 by
  the repo ruleset `protect-main` (requires a PR and a green `test` check; no
  bypass actors; branch deletion blocked). Before that, a Dispatch test
  demonstrated local sessions could push main directly. All surfaces must use
  branch → PR.

## Merge automation (phone-friendly loop)

- **Auto-merge** is enabled on the repo (`allow_auto_merge: true`). Because
  the ruleset makes the `test` check required, a PR can be queued to merge
  the moment CI goes green:
  `gh pr merge <num> --auto --squash` (or the Enable auto-merge button).
  Merging to main then triggers the CI deploy as usual.
- **Auto-fix** (Claude watches a PR and pushes fixes for CI failures /
  review comments) needs no repo setup beyond the already-installed Claude
  GitHub App. It is a **per-PR opt-in**: in a web session's CI status bar
  select "Auto-fix"; from a terminal run `/autofix-pr` on the PR's branch;
  from the mobile app tell Claude to watch the PR. Caveats: it can't react
  to merge conflicts (no webhook — ask the session to rebase), and its review
  replies post from Connor's account (labeled as Claude Code).
- Net flow from a phone: cloud session pushes branch → tap "Create PR" →
  enable auto-merge (and optionally Auto-fix) → CI green → auto-merges →
  CI deploys → news.cuteteal.com updated.

Caveat: pushes that modify `.github/workflows/*` may be rejected for cloud
sessions (the GitHub proxy's scoped credential may lack the `workflow`
permission). Make workflow edits locally/Dispatch.

## Verification checklists

**CI + deploy** (any local session can run this): open a PR with a visible
page change → `test` job green → merge → `deploy` job green (`gh run watch`)
→ `curl -s https://news.cuteteal.com` shows the change.

**Cloud session** (Connor starts at claude.ai/code): task it with running
`npm test`, reporting `node --version` and `$CLAUDE_CODE_REMOTE`, then making
a small change and pushing its branch. Verifies: App clone, SessionStart hook
`npm ci`, hermetic tests on stock Node, branch push through the proxy. Land it
via the normal PR → CI flow.

**Dispatch** (Connor, from phone/Cowork; desktop app running): task it with
running `npm test` in the news repo. Verify the session appears in the Code
tab with a "Dispatch" badge and tests pass. Optional: commit/push/PR to
exercise SSH + CI deploy.

## One-time setup status

- [x] Claude GitHub App installed with access to `couetilc/news` (claude.ai/code onboarding)
- [x] claude.ai environment created: Trusted network, no env vars, no setup script
- [x] GitHub Actions secret `CLOUDFLARE_API_TOKEN` set on the repo
- [x] Local `.env` populated (see `.env.example`)
- [x] Verified 2026-06-10: CI deploy (PRs #1–#3), Dispatch (`npm test` + edit
      pushed to main from Connor's Mac), cloud session (`npm test` + branch
      `claude/keen-pascal-wo54he` pushed via GitHub proxy, landed as PR #3)

## Official documentation

- Dispatch & desktop sessions: https://code.claude.com/docs/en/desktop#sessions-from-dispatch and https://support.claude.com/en/articles/13947068
- Cloud sessions (environment, setup scripts, network, GitHub proxy): https://code.claude.com/docs/en/claude-code-on-the-web
- Cloud quickstart (GitHub App, environments): https://code.claude.com/docs/en/web-quickstart
- SessionStart hooks: https://code.claude.com/docs/en/hooks#sessionstart
- Skills format (this file): https://code.claude.com/docs/en/skills
- wrangler-action: https://github.com/cloudflare/wrangler-action
