# Repo git hooks

Versioned hooks so every surface gets the same git lifecycle automation —
most importantly **auto-push on commit** (`post-commit`).

## How each surface wires this folder

| Surface | Wiring | Who does it |
|---|---|---|
| Agent container (`./bin/claude`) | `git config --global core.hooksPath /workspace/.git-hooks` | `docker/entrypoint.sh`, automatic |
| Cloud sessions (claude.ai) | `git config core.hooksPath .git-hooks` | `scripts/session-start.sh`, automatic |
| Connor's machine | nothing — the global `~/.git-hooks/post-commit` already auto-pushes | n/a (opt in with `git config core.hooksPath .git-hooks` if desired) |

## Delegation contract

Setting a repo-local `core.hooksPath` makes git ignore the global hooks dir,
which on Connor's machine carries gitleaks (`pre-commit`), commit-message
validation (`commit-msg`), git-lfs glue, and an auto-push `post-commit`. So
every hook in this folder first delegates to `~/.git-hooks/<same-name>` when
that file exists and is executable:

- `post-commit` delegates *instead of* pushing itself (the global hook
  already pushes); without a global hook it pushes the current branch to
  origin (`-u`), skipping `main` (blocked by ruleset) and detached HEAD.
- `pre-commit` delegates when a global hook exists; otherwise it runs
  gitleaks itself (`gitleaks git --pre-commit --staged`), blocking the commit
  on findings. The agent container bakes in gitleaks (version pinned in
  `docker/Dockerfile` to match the host); environments without the binary
  (cloud VM) warn and continue — the protect-main ruleset and CI still gate
  what reaches main.
- All other hooks here are pure delegators (exit 0 when no global hook).

When adding a new hook to this folder, keep that pattern: delegate first,
then add repo-specific behavior that must also work where no global hooks
exist (container, cloud).
