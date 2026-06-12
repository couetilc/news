#!/bin/bash
# SessionStart hook: bootstrap cloud sessions (fresh VM clones have no
# node_modules). Local sessions already manage their own installs — no-op.
# CLAUDE_CODE_REMOTE=true only in claude.ai cloud sessions.
set -u

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/..}"

# Repo-versioned git hooks (auto-push on commit; see .git-hooks/README.md).
git config core.hooksPath .git-hooks

# Idempotent: skip when deps already match the lockfile (resumed sessions).
if [ -d node_modules ] && [ node_modules/.package-lock.json -nt package-lock.json ]; then
  exit 0
fi

npm ci
