# Repo git hooks

Self-contained, versioned hooks giving every surface the same git lifecycle
automation. No delegation to machine-global hooks — everything a hook needs
ships with the repo (or is baked into the agent container image).

- `pre-commit` — gitleaks scan of staged changes; blocks the commit on
  findings. The agent container bakes in the binary (version pinned in
  `docker/Dockerfile`); environments without gitleaks (e.g. the cloud VM)
  warn and continue — the protect-main ruleset and CI gate what reaches main.
- `post-commit` — auto-push: pushes the current branch to origin (`-u`) after
  every commit, skipping `main` (ruleset blocks it) and detached HEAD.
  Committing IS publishing the branch.

## How each surface wires this folder

| Surface | Wiring | Who does it |
|---|---|---|
| Agent container (`./bin/claude`) | `git config --global core.hooksPath /workspace/.git-hooks` | `docker/entrypoint.sh`, automatic |
| Cloud sessions (claude.ai) | `git config core.hooksPath .git-hooks` | `scripts/session-start.sh`, automatic |
| Connor's machine | opt in per clone: `git config core.hooksPath .git-hooks` | manual (his global `~/.git-hooks` provides similar behavior otherwise) |
