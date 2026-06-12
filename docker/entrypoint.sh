#!/bin/bash
# Bootstrap the agent container, then exec the requested command (default:
# claude --dangerously-skip-permissions, see Dockerfile CMD / bin/claude).
set -e

# Git identity comes from the host via bin/claude; fall back to repo owner.
git config --global user.name "${GIT_USER_NAME:-Connor Couetil}"
git config --global user.email "${GIT_USER_EMAIL:-connor@couetil.com}"

# The mounted repo's origin uses SSH, but no SSH keys exist in here (that's
# the point). Rewrite to HTTPS and let gh supply GH_TOKEN as the credential.
git config --global url."https://github.com/".insteadOf "git@github.com:"
# Bind-mounted /workspace may be owned by a different uid than `node`.
git config --global --add safe.directory /workspace
if [ -n "${GH_TOKEN:-}" ]; then
	gh auth setup-git 2>/dev/null || true
fi

# node_modules is a container-private named volume (host node_modules holds
# darwin-arm64 binaries like workerd that can't run here). Install when stale.
if [ -f /workspace/package-lock.json ]; then
	if [ ! -f /workspace/node_modules/.package-lock.json ] \
		|| [ /workspace/package-lock.json -nt /workspace/node_modules/.package-lock.json ]; then
		(cd /workspace && npm ci)
	fi
fi

exec "$@"
