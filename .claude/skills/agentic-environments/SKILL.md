---
name: agentic-environments
description: Set up a native laptop or worktree, check GitHub and Cloudflare access, and verify PR-to-production delivery for this repo.
---

# Native development and delivery

Start with [CLAUDE.md](../../../CLAUDE.md#native-laptop-setup). Node 24, npm,
local workerd bindings and the installed agent tools are sufficient. Follow its
[Authorization policy](../../../CLAUDE.md#authorization); environment setup
does not grant new scope or require repeated approvals.

## Resolve the actual environment

- `.envrc` leaves PATH unchanged. `command -v codex` and `command -v claude`
  should find host installations, not `.agent/bin`. `command codex` still
  searches PATH and cannot bypass a shadowing shim. If an existing direnv
  checkout's `.envrc` changes, use `direnv allow` and let its shell reload.
- Each task owns its worktree, dependencies, `.wrangler`, `.astro`, `dist` and
  dev port. Do not symlink another task's mutable state or kill its server.
- `.env` and `.dev.vars` are ignored and do not appear in new worktrees. Use a
  local-only `AUTH_PEPPER`; do not copy production runtime secrets.
- `npm run test:e2e` owns isolated build/state/port and needs no dev server.
  On a native machine install the pinned Chromium with
  `npx playwright install chromium`.

## Verify access without exposing secrets

- Inspect the configured remote and `gh auth status`. HTTPS/keyring and SSH
  have different requirements; test the configured path. A read or dry-run push
  does not prove permission to write; verify the task's actual branch push.
- Git hooks are host configuration. Inspect `core.hooksPath`; a clean clone
  does not install Connor's hooks. Confirm the branch exists remotely.
- Workflow-file changes require workflow write permission. Check the actual
  credential or existing GitHub integration before publishing; don't start an
  unrelated login or print a token as a diagnostic.
- `npx wrangler whoami` verifies the current Cloudflare identity. A successful
  identity check is not proof of resource-specific scopes; inspect the actual
  resource/action needed. `.env.example` documents required scopes.
- CI has its own Cloudflare token. Canonical delivery is PR → required `test`
  and `e2e` on the current head → merge → successful CI deploy → `/status`
  reports the merged commit → verify the affected app behavior.

For an explicitly requested container or cloud session, read
[optional surfaces](references/optional-surfaces.md). Do not configure those
surfaces as part of native laptop work.
