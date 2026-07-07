# .agent/ — news agent-container config

This directory configures [`@couetilc/agentic-coding`][pkg] for this repo: it
runs Claude Code / Codex in a disposable, non-root Docker container that clones
the repo fresh from GitHub and nothing else. Nothing from your machine is
mounted; work leaves the container only via `git push`. The whole directory is
committed — the engine itself ships as a versioned npm package and is never
vendored here.

This README is engine-owned and regenerated on every `agent init`; edit
`config.js` and `init.sh` instead. It is written so a host-side coding agent can
maintain the config without further context.

[pkg]: https://www.npmjs.com/package/@couetilc/agentic-coding

## Files

| File | Owner | Purpose |
| --- | --- | --- |
| `config.js` | you | project/repo/ports/agents/caches — pure data (§ below) |
| `init.sh` | you | user-space bootstrap, run in-container after clone |
| `Dockerfile` | you | OPTIONAL overlay for root/system deps (not created by default) |
| `package.json` | engine | `{"type":"module"}` so `config.js` parses as ESM |
| `README.md` | engine | this file |
| `bin/{agent,claude,codex}` | engine | PATH shims → `npx @couetilc/agentic-coding` |
| `env.example` | engine | documents the tokens; real values go elsewhere |

Engine-owned files are regenerated each `agent init`; your files are never
overwritten. Commands: `agent claude`, `agent codex`, `agent shell`,
`agent clean`, `agent doctor`, `agent init`.

## Adding a port

A named port gets a fresh random localhost port per launch, injected into the
container as `$DEV_HOST_<NAME>`. In `config.js`:

```js
ports: { astro: 4321 },   // container port 4321 → $DEV_HOST_ASTRO on a random host port
```

The launcher prints the `http://127.0.0.1:<host>/` URL. The dev server must bind
`0.0.0.0` inside the container (e.g. `npm run dev -- --host`), or forwarded
traffic never reaches a loopback-only listener.

## Adding dependencies — overlay vs init.sh

The container is **non-root at runtime**, so an init script *cannot* `apt
install`. The split:

- **Root / system deps → `.agent/Dockerfile` overlay.** `apt-get` packages,
  `/usr/local` binaries, browser libraries. Built *before* the container starts,
  as root. The build context is `.agent/` and **the repo clone does not exist at
  build time** — never reference repo files here.
- **User-space, repo-dependent bootstrap → `.agent/init.sh`.** `npm ci`,
  `uv sync`, generating files. Runs as the non-root `node` user *after* the
  clone. A failure warns but does not block the session.

To add an overlay, copy the packaged `Dockerfile.tmpl` example to
`.agent/Dockerfile` and uncomment it — the minimal form is:

```dockerfile
ARG BASE
FROM ${BASE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends some-pkg \
    && rm -rf /var/lib/apt/lists/*
USER node
```

The CLI injects the base image tag as the `BASE` build-arg, so there is no
version literal to drift. When `.agent/Dockerfile` is present the CLI builds it
`FROM` the base and runs the result; when absent, the base image is used
directly.

## Tokens

Never committed. Two files, merged at launch (project overrides host):

- **Project tokens → `./.env`** (repo root, gitignored). `GH_TOKEN` (required —
  clone/push) plus any deploy tokens and every `requiredEnv` key. See
  `.agent/env.example` for the exact `GH_TOKEN` scopes and creation steps.
- **Host tokens → `~/.config/agentic-coding/env`** (shared across all projects).
  `CLAUDE_CODE_OAUTH_TOKEN` (from `claude setup-token`), optional
  `OPENAI_API_KEY`. Codex also uses a host `codex login` credential directly.

`agent doctor` prints which tokens are found (values redacted) and which file a
missing one belongs in.

## Updating

The shims pin the major: `npx -y @couetilc/agentic-coding@^0 ...`. Patch
and minor releases arrive automatically the next time you run a command (npx
resolves the newest matching version). A **major** bump is deliberate: re-run
`agent init` to rewrite the shims to the new major (`@^0` → the next).
Re-running `agent init` is always safe — it regenerates engine-owned files and
leaves `config.js` and `init.sh` untouched.

## PATH shadowing

The `.agent/bin` shims are added to PATH via `.envrc` (`direnv allow` to
activate). While active, typing `claude` or `codex` in this project launches the
**container**, not the host CLI. Escape hatch: `command claude` runs the real
host binary. `agent` is unambiguous.

## Recovery

Work leaves the container **only via git** — commits are gitleaks-gated
(pre-commit) then auto-pushed (post-commit), so the primary recovery path is the
pushed branch. Containers are kept after exit (never `--rm`), so unpushed work is
salvageable with `docker cp <container>:/workspace/<path> .` (find the name in
`docker ps -a`, or the one the launcher printed). `agent clean` prunes this
project's exited containers and rebuilds the images from scratch — run it once
you have recovered anything you need.
