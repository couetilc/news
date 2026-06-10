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

- [ ] Claude GitHub App installed with access to `couetilc/news` (claude.ai/code onboarding)
- [ ] claude.ai environment created: Trusted network, no env vars, no setup script
- [x] GitHub Actions secret `CLOUDFLARE_API_TOKEN` set on the repo
- [x] Local `.env` populated (see `.env.example`)

Update the checkboxes as setup completes.

## Official documentation

- Dispatch & desktop sessions: https://code.claude.com/docs/en/desktop#sessions-from-dispatch and https://support.claude.com/en/articles/13947068
- Cloud sessions (environment, setup scripts, network, GitHub proxy): https://code.claude.com/docs/en/claude-code-on-the-web
- Cloud quickstart (GitHub App, environments): https://code.claude.com/docs/en/web-quickstart
- SessionStart hooks: https://code.claude.com/docs/en/hooks#sessionstart
- Skills format (this file): https://code.claude.com/docs/en/skills
- wrangler-action: https://github.com/cloudflare/wrangler-action
