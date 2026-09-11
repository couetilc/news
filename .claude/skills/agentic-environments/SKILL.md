---
name: Agentic dev environments
description: Set up native laptop agent development, verify GitHub and Cloudflare credentials, and follow the PR-to-deploy path. Includes optional container and Claude cloud execution guidance.
when_to_use: Setting up a laptop or fresh worktree; debugging credentials, command resolution, or deploys; explicitly using an optional container or cloud surface.
---

# Agentic dev environments for this repo

This repo (`couetilc/news` → https://news.cuteteal.com) defaults to native
Codex or Claude agents on Connor's laptop. GitHub Actions deploys merged work.
Container and Claude cloud sections are optional surface-specific guidance;
do not configure them as part of native setup.

## Native laptop workflow

Follow the short setup in `CLAUDE.md`: Node 24, a topic branch or separate
worktree, `npm ci`, `npm run db:migrate:local`, and
`npx playwright install chromium`. The cloud-only SessionStart hook does
nothing locally, so dependencies and local migrations are explicit steps.

- **Native commands:** `.envrc` leaves PATH unchanged. `command -v codex` and
  `command -v claude` should resolve installed host CLIs, never `.agent/bin`.
  In a previously enabled direnv checkout, run `direnv allow` and let the
  shell reload the changed entry. `command codex` still searches PATH; it
  cannot bypass a container shim. Optional launchers are explicitly
  `./.agent/bin/agent codex` and `./.agent/bin/agent claude`. If `agent init`
  regenerates wrapper guidance or `.envrc`, retain this native PATH default.
- **State isolation:** run commands inside the task's worktree. Keep its own
  `node_modules`, `.wrangler`, `.astro`, and `dist`; do not symlink another
  worktree's state. Use a distinct dev port and the printed loopback address.
  `npm run test:e2e` creates and removes its own build/state/port automatically.
- **Runtime secrets:** create ignored `.dev.vars` with a random local-only
  `AUTH_PEPPER` (needed for auth in built preview). Do not copy production
  peppers or sessions. `.env` holds tooling credentials only; neither file
  is provided by `git worktree add`.
- **GitHub:** inspect `git remote get-url origin` and `gh auth status` without
  printing token values. HTTPS can use the gh keyring; SSH requires a working
  key. Existing native authentication normally needs no extra `GH_TOKEN`.
  Workflow-file pushes require OAuth/classic PAT `workflow` scope or
  fine-grained Workflows write; a laptop or ordinary push is not proof of
  that permission. Check the credential or connected GitHub integration.
- **Git hooks:** inspect `git config --show-origin --get core.hooksPath`.
  Connor's current global hooks are machine configuration; a fresh clone
  doesn't install them. Commit and push explicitly, then verify the remote
  branch instead of assuming auto-push.
- **Cloudflare:** local development and tests use local bindings without a
  production token. For production inspection/manual fallback, verify the
  existing `.env` token or Wrangler OAuth with `npx wrangler whoami`; never
  print credentials. Canonical deployment uses the CI repo secret.
- **Delivery:** PR → both `test` and `e2e` green on the PR head → merge →
  successful CI `deploy` → inspect https://news.cuteteal.com. Existing review
  policies still apply; environment setup does not grant new permissions.

## Execution contexts

| Surface | Where code runs | Triggered from | Repo access | Can deploy? |
|---|---|---|---|---|
| Local CLI / desktop app | Connor's Mac, `~/repos/news` | Terminal / Code tab | Working tree, verified HTTPS/keyring or SSH push | Yes (manual fallback) |
| **Dispatch** | **Connor's Mac** (desktop app must be running & awake) | Phone / Cowork tab | Same local working tree and verified git auth | Yes (same as local) |
| Cloud sessions (claude.ai/code, `claude --remote`) | Anthropic-managed Ubuntu 24.04 VM (4 vCPU / 16 GB / 30 GB) | Web, mobile, CLI | Fresh clone via GitHub App proxy; **push restricted to the session's own branch**; changes land via PR | **No** (by design) |
| Agent container (`agent claude`) | Docker on Connor's Mac, full-auto (`--dangerously-skip-permissions`) | Terminal | Fresh clone from GitHub into container-private `/workspace`; HTTPS push via `GH_TOKEN` | Possible but discouraged — use PRs |
| GitHub Actions | GitHub-hosted runner | Push / PR events | `actions/checkout` | **Yes — the canonical deploy path** |

Key facts:

- **Dispatch is NOT cloud execution.** It is remote *triggering* of a local
  session. If the Mac is asleep or the desktop app closed, Dispatch tasks
  cannot run. Dispatch sessions inherit everything local: the host's node 24,
  `.env`, wrangler OAuth/token, SSH keys, gh keyring.
- **Cloud sessions are sandboxed.** The git client holds only a scoped
  credential; a GitHub proxy translates it outside the sandbox and restricts
  pushes to the current working branch. Sessions persist after you close the
  browser; hand off with `claude --teleport <session-id>` (cloud → terminal)
  or `claude --remote "task"` (terminal → cloud).

## Credentials matrix

`.env.example` (project tokens: `CLOUDFLARE_API_TOKEN`, `GH_TOKEN`) and
`.agent/env.example` (adds the host-level agent CLI credentials in
`~/.config/agentic-coding/env`) are the living documentation for token scopes.
Current state:

| Surface | Cloudflare | GitHub |
|---|---|---|
| Local + Dispatch | `CLOUDFLARE_API_TOKEN` in `.env` (or `npx wrangler login` OAuth) | Verified HTTPS/gh keyring or SSH key |
| Cloud sessions | **None — deliberately credential-free** | Scoped credential via GitHub App proxy (automatic) |
| GitHub Actions | Repo Actions secret `CLOUDFLARE_API_TOKEN` (same token value as `.env`) | Built-in `GITHUB_TOKEN` |

Cloud sessions need no Cloudflare token: deploys happen in CI after merge, so
they need no network exception. The claude.ai environment has no dedicated
secrets store (env vars are visible to anyone who can edit the environment), so
keeping it empty is the safest default.

## Optional cloud environment recipe (claude.ai settings)

The environment for this repo should be configured as:

- **Network access:** Trusted (default)
- **Environment variables:** none
- **Setup script:** none

No setup script is needed: the VM preinstalls Node 20/21/22 via nvm and stock
Node 22 satisfies our `engines` requirement (>=22.12.0); `npm ci` is handled by
the repo's SessionStart hook (below).

If Node version drift ever breaks the build in cloud sessions, paste this as
the environment's setup script:

```bash
#!/bin/bash
# Best-effort: align cloud Node with the repo's node 24 pin; never block the session.
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

Division of labor: tools/runtimes the VM lacks → setup script (cached
snapshot); project dependency install → SessionStart hook (runs every session,
repo-versioned).

## Optional agent container (`./.agent/bin/agent claude` / `./.agent/bin/agent codex`)

Local full-auto surface, driven by the published **`@couetilc/agentic-coding`**
tool (use `./.agent/bin/agent` for `agent` below; host prereqs: node, docker,
git) and configured by this repo's committed
**`.agent/`** directory — `config.js` names the project/repo/ports/agents/caches,
`Dockerfile` is the overlay, `init.sh` is the in-container bootstrap, and
`.agent/README.md` is the host-side config reference. `agent claude` runs
`claude --dangerously-skip-permissions`; `agent codex` runs `codex` at parity;
`agent shell` drops into bash; `agent clean` prunes + rebuilds; `agent doctor`
prints the resolved config. The image is **two-stage**: a shared **base**
(`agentic-coding-base:<pkg-version>` — node:24-slim matching the repo's node
pin, git, gh, gitleaks, ripgrep, uv, and both agent CLIs; non-root `node` user,
required because `--dangerously-skip-permissions` refuses to run as root) plus
this repo's **`.agent/Dockerfile` overlay** (tagged `agentic-news:<version>`)
that re-adds shellcheck, actionlint, and a headless Chromium/Playwright shell.

- **Nothing from the host is mounted**: the entrypoint clones the repo fresh
  from GitHub at launch (`GH_TOKEN`, HTTPS) into the container-private
  `/workspace`. Parallel containers share nothing (but the package caches) and
  the host filesystem is unreachable — **work enters via the remote and leaves
  only via git**: each commit is gitleaks-gated (pre-commit) then auto-pushed
  (post-commit) by hooks **baked into the base image at `/opt/agent/hooks`** (no
  per-project `.git-hooks/` any more; the post-commit skip is driven by the
  `defaultBranch` from `config.js`), landing as a branch for the normal PR → CI
  → merge flow. A container starts from origin's state, so hand it in-progress
  work by committing first (auto-push publishes the branch), then checking out
  that branch in the session.
- `agent claude [args]` → builds the base + overlay if needed and runs claude
  full-auto; `agent shell [cmd]` drops into bash; `agent clean` removes THIS
  project's exited containers (label-scoped to `agentic-coding.project=news`, so
  it never touches another project's kept containers) AND rebuilds the images
  from scratch (`--pull --no-cache`) so the baked-in CLIs don't freeze at
  image-build-time latest. Containers are **kept after exit** (never `--rm`) so
  unpushed work is recoverable via `docker cp` (see "Recovering work" below).
- **First-run UX + surface identity**: the entrypoint pre-seeds
  `~/.claude.json` (onboarding + bypass-permissions + /workspace trust) for
  Claude and `~/.codex/config.toml`
  (`[projects."/workspace"].trust_level = "trusted"`) for Codex, so sessions
  drop straight into the coding UI. It also writes generic container-scoped
  global instructions (`~/.claude/CLAUDE.md` or `~/.codex/AGENTS.md` — the
  isolation contract, branch/commit/push discipline, and a pointer to the repo's
  own `CLAUDE.md`/`AGENTS.md` and `/workspace/.agent/README.md`). The
  news-specific surface identity (baked toolchain, PR-only path to prod, backlog
  = `gh issue list`) lives in this repo's auto-loaded `CLAUDE.md`.
- **Model quirk under setup-token auth**: the session bills the Max
  subscription ("inference-only" limits capability scope, not billing), but
  entitlement metadata under-reports — the /model picker omits Fable and
  `best` falls back to Opus. Explicit ids work fine, so the entrypoint seeds
  `~/.claude/settings.json` with the model + effort from `.agent/config.js`
  (`agents.claude` = `claude-fable-5` / `xhigh`; `agents.codex` = `gpt-5.5` /
  `xhigh`) — update those ids in `config.js` when a newer model ships (no image
  rebuild needed). Default effort is **xhigh** (passed on the invocation + the
  settings seed).
- **CLI freshness**: claude is installed via the native installer under
  `~/.local` (node-owned) in the base image; the entrypoint runs `claude update`
  before every session start, while mid-session auto-update stays disabled for
  predictability. `agent clean` rebuilds also refresh the base image (node, gh,
  gitleaks, the CLIs) and the overlay.
- **`.dev.vars` gap**: `.dev.vars` (Worker runtime secrets for local dev) is
  gitignored, so container clones don't have it — runtime-secret dev currently
  happens on the host. No distribution path into the container exists yet.
- **Env injection**: the launcher merges two `--env-file`s (project overrides
  host). The **host** file `~/.config/agentic-coding/env` carries the agent CLI
  credentials shared across every project — `CLAUDE_CODE_OAUTH_TOKEN` (from
  `claude setup-token`; Keychain isn't mountable) and optional `OPENAI_API_KEY`.
  The **project** file `./.env` carries `GH_TOKEN` (clone/push; the SSH remote is
  rewritten to HTTPS in the container, no SSH keys inside) plus
  `CLOUDFLARE_API_TOKEN` for ad-hoc wrangler use. Codex's `~/.codex/auth.json` is
  base64-injected off the host `codex login`. See `.agent/env.example` (host +
  project) and this repo's `.env.example` (project tokens).
- `npm ci` runs from **`.agent/init.sh`** (the project bootstrap the entrypoint
  executes after the clone, as non-root `node`) into the container's own
  filesystem (host darwin-arm64 binaries like workerd can't run on Linux); the
  shared `agentic-npm-cache` volume — plus the `agentic-news-uv` cache from
  `caches: ['uv']` in `config.js` — keeps repeat installs fast.
- **Reaching the dev server from the host**: the launcher picks a random free
  host port for each named port in `config.js` (`ports: { astro: 4321, wrangler:
  8787 }`), binds the container's 4321/8787 to them, and injects the host-side
  addresses as `$DEV_HOST_ASTRO` / `$DEV_HOST_WRANGLER` (printed at startup;
  these replace the old `$DEV_HOST_4321` / `$DEV_HOST_8787`). Two gotchas: (1)
  start the dev server on all interfaces — `npm run dev -- --host` — because
  Docker forwards published ports to the container's external interface and a
  localhost-only listener never sees that traffic; (2) report
  `http://$DEV_HOST_ASTRO/`, **not** `localhost:4321` (the in-container port,
  random on the host). `docker port <name> 4321` works as a fallback.
- **Tooling policy** (also in this repo's `CLAUDE.md` surface identity): agents
  run as non-root, so system packages can't be installed mid-session — one-off
  needs use user-space installs (`npx`, devDependency, binary in `~/.local/bin`);
  a tool earns a `.agent/Dockerfile` overlay entry only on second need (via a
  human-gated PR, with a one-line justification comment naming its workflow).
  The split: root/system deps go in the overlay, user-space + repo-dependent
  setup goes in `.agent/init.sh`.
- **Headless browser (Playwright) baked in via the overlay**: this repo's
  `.agent/Dockerfile` installs a headless Chromium shell + its apt deps
  (`playwright install --with-deps --only-shell chromium`, run as root before the
  `USER node` drop) into a world-readable
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, version-pinned (`PLAYWRIGHT_VERSION`,
  1.61.0) in lockstep with the `@playwright/test` devDependency. This lets the
  `verify`/`run` skills drive the dev server in a real browser. Two must-knows:
  (1) launch with **`chromium.launch({ args: ['--no-sandbox'] })`** — non-root
  Chromium can't use the container sandbox (throwaway container, so it's fine);
  (2) point the browser at `http://$DEV_HOST_ASTRO/` after `npm run dev --
  --host`. Browser/e2e tests run via `npm run test:e2e`, outside the hermetic
  `npm test` suite and its coverage gate.
- **Isolation contract, honestly stated**: protects the host filesystem,
  Keychain, SSH keys, and other repos. It does NOT protect the tokens
  injected from the env files (readable as env vars by anything in the container)
  and has unrestricted network egress. For egress restriction, adapt
  Anthropic's reference firewall:
  https://github.com/anthropics/claude-code/tree/main/.devcontainer
  (init-firewall.sh; needs NET_ADMIN/NET_RAW). Only use with trusted repo
  content. A lighter alternative for fewer prompts without skipping checks is
  permission "auto mode" (classifier-reviewed).
- **Auto-push on commit**: the container's git hooks are **baked into the base
  image at `/opt/agent/hooks`** (pre-commit gitleaks gate + post-commit
  auto-push) and wired automatically by the entrypoint (`core.hooksPath`). Branch
  commits push themselves — the `defaultBranch` (`main`) is skipped (ruleset
  blocks it). In the clone-per-container model this is the data path: an unpushed
  commit exists only inside that container. **Migration note:** the old
  repo-versioned `.git-hooks/` were removed when this repo moved to
  `@couetilc/agentic-coding` — only the container still auto-pushes (via the
  baked hooks). Connor's machine relies on equivalent global hooks; **cloud
  sessions no longer auto-push** (the SessionStart hook used to wire
  `.git-hooks/`), so in a cloud session `git push` explicitly or land the branch
  via the claude.ai "Create PR" flow.

### Recovering work across container runs

`@couetilc/agentic-coding` **drops the `--resume` flag** news's old launcher had
— it was a footgun: `docker start -ai` on a headless `-p` container replays the
container's original command, re-running that autonomous prompt's
edits/commits/pushes. Recovery in the package model has two paths, preferred
first:

1. **The pushed branch (primary).** Every commit auto-pushes, so finished work is
   already a branch on GitHub — pick it up in any new session with `git fetch` +
   checkout. This is the whole point of the clone-per-container + auto-push
   design: an unpushed commit exists only inside that one container.
2. **`docker cp` from the kept container (salvage).** Containers are kept after
   exit (never `--rm`), so uncommitted/unpushed files can be copied out:
   `docker cp <container>:/workspace/<path> .`. Find the container with
   `docker ps -a --filter label=agentic-coding.project=news` (names look like
   `agentic-news-<agent>-<timestamp>`).

- **`agent clean` deletes salvageability.** It `docker rm`s every exited
  container for THIS project (label-scoped, so other projects' kept containers
  are untouched) and rebuilds the images. Copy out anything you need first — but
  the durable path is always to have committed (auto-push publishes the branch)
  before cleanup.
- No shared session/transcript store (named volume or host bind-mount) is used:
  it would pool concurrent containers' transcripts — cross-task/cross-branch
  bleed, concurrent appends corrupting the append-only `.jsonl` files, and
  durable persistence of secret-laden output (transcripts capture command
  results, and the home holds the injected `CLOUDFLARE_API_TOKEN`/`GH_TOKEN` and
  Codex's `~/.codex/auth.json`), widening the blast radius the isolation contract
  does not cover.

## Network access (cloud sessions)

Modes: **None** / **Trusted** (allowlisted package registries, GitHub, some
cloud SDKs) / **Full** (any domain) / **Custom** (your allowlist, optionally
plus the Trusted defaults). All egress passes through Anthropic's security
proxy; GitHub traffic uses its own separate proxy regardless of mode.

Facts that drive our choices:

- `api.cloudflare.com` is **not** in the Trusted allowlist → `wrangler deploy`
  fails from a Trusted cloud session. That's fine: deploys belong to CI.
- **Testing policy: vitest must never hit the network.** Mock all external
  HTTP. This keeps `npm test` working under Trusted, in CI, and offline.
- When feature work needs to fetch live feeds/APIs *during cloud development*,
  switch the environment to **Custom**, list the feed domains (one per line,
  `*.` wildcards supported), and check "Also include default list of common
  package managers". Otherwise develop live-fetch features locally or via
  Dispatch. Changing network settings invalidates the environment cache (setup
  script re-runs).

## Playwright e2e in cloud sessions

`npm run test:e2e` fails out of the box on the cloud VM. The VM preinstalls
Playwright browsers at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers` (and sets
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`), but that build lags the repo's
`@playwright/test` pin, and Playwright refuses to launch a build revision it
didn't install (missing-executable error). `npx playwright install chromium` —
the host guidance in CLAUDE.md — cannot fix it there: the Playwright browser
CDN is egress-blocked under the environment's network policy (Trusted mode).

Run **`scripts/pw-browser-shim.sh`** instead. It derives the pinned build
revision from `node_modules/playwright-core/browsers.json` and globs the
preinstalled dir for the available one (no hardcoded build numbers — it
survives version bumps on either side), builds a symlink shim at
`node_modules/.cache/pw-browser-shim` mapping the pinned build's expected
directory layout onto the preinstalled binaries (the inner layout is
arch-dependent and changed across builds: `chrome-linux/headless_shell` →
`chrome-headless-shell-linux64/chrome-headless-shell` on linux-x64),
probe-launches the shimmed headless shell, then **execs
`PLAYWRIGHT_BROWSERS_PATH=<shim> npm run test:e2e`** — extra script arguments
pass through to `playwright test` (e.g. `scripts/pw-browser-shim.sh --grep
signup`). Where the installed build already matches the pin (the agent
container; a host after `npx playwright install chromium`) it says so and
exits 0 — run `npm run test:e2e` directly there.

The skew this creates (an older headless shell under a newer client) is minor
and fine for these UI specs, but it is a cloud-session convenience only — CI
installs the pinned browser properly and never uses the shim.

## Deploy paths

1. **Canonical:** branch → PR → CI `test` (100% coverage) + `e2e` jobs → merge to
   `main` → CI `deploy` job (`npm run build` + `cloudflare/wrangler-action`).
   Works identically for changes authored locally, via Dispatch, or in cloud
   sessions.
2. **Manual fallback:** `npm run deploy` from a machine with `.env` or
   wrangler OAuth (local/Dispatch only).
3. Cloud sessions never deploy directly.

Surface behaviors:

- **Cloud sessions cannot open PRs.** The sandbox has no `gh` CLI and no
  GitHub API credential — its scoped git credential only clones, fetches, and
  pushes the session branch. A cloud session's job ends at "branch pushed";
  the PR is then created either from the session UI on claude.ai (Create PR
  button) or by any credentialed session (`gh pr create --head <branch>`).
- **Direct pushes to `main` are mechanically blocked** by the repo ruleset
  `protect-main` (requires a PR and green `test` + `e2e` checks; no bypass actors;
  branch deletion blocked). All surfaces must use branch → PR.

## Merge automation (phone-friendly loop)

- **Auto-merge** is enabled on the repo (`allow_auto_merge: true`). Because
  the ruleset requires both `test` and `e2e`, a PR can be queued to merge
  the moment CI goes green:
  `gh pr merge <num> --auto --squash` (or the Enable auto-merge button).
  Merging to main then triggers the CI deploy.
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
permission). Local/Dispatch credentials also need workflow permission; verify
the actual credential or available GitHub integration before planning a push.

## Verification checklists

**CI + deploy** (a credentialed session): use the task's actual PR → `test`
and `e2e` green on its head → merge → `deploy` green (`gh run watch`) →
`curl -s https://news.cuteteal.com` and browser inspection verify the deployed
app. Do not invent a page change just to exercise deployment.

**Cloud session** (Connor starts at claude.ai/code): task it with running
`npm test`, reporting `node --version` and `$CLAUDE_CODE_REMOTE`, then making
a small change and pushing its branch. Verifies: App clone, SessionStart hook
`npm ci`, hermetic tests on stock Node, branch push through the proxy. Land it
via the normal PR → CI flow.

**Dispatch** (Connor, from phone/Cowork; desktop app running): task it with
running `npm test` in the news repo. Verify the session appears in the Code
tab with a "Dispatch" badge and tests pass. Optional: commit/push/PR to
exercise the configured git transport + CI deploy.

## Official documentation

- Dispatch & desktop sessions: https://code.claude.com/docs/en/desktop#sessions-from-dispatch and https://support.claude.com/en/articles/13947068
- Cloud sessions (environment, setup scripts, network, GitHub proxy): https://code.claude.com/docs/en/claude-code-on-the-web
- Cloud quickstart (GitHub App, environments): https://code.claude.com/docs/en/web-quickstart
- SessionStart hooks: https://code.claude.com/docs/en/hooks#sessionstart
- Skills format (this file): https://code.claude.com/docs/en/skills
- wrangler-action: https://github.com/cloudflare/wrangler-action
