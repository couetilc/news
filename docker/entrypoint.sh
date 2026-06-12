#!/bin/bash
# Bootstrap the agent container, then exec the requested command (default:
# claude --dangerously-skip-permissions, see Dockerfile CMD / bin/claude).
set -e

# Git identity comes from the host via bin/claude; fall back to repo owner.
git config --global user.name "${GIT_USER_NAME:-Connor Couetil}"
git config --global user.email "${GIT_USER_EMAIL:-connor@couetil.com}"

# The repo's origin uses SSH, but no SSH keys exist in here (that's the
# point). Rewrite to HTTPS and let gh supply GH_TOKEN as the credential.
git config --global url."https://github.com/".insteadOf "git@github.com:"
git config --global --add safe.directory /workspace
# Repo-versioned git lifecycle hooks (gitleaks pre-commit, auto-push on
# commit; see .git-hooks/).
git config --global core.hooksPath /workspace/.git-hooks
if [ -n "${GH_TOKEN:-}" ]; then
	gh auth setup-git 2>/dev/null || true
fi

# Each container gets its own copy of the host working tree (snapshot of
# /src, mounted read-only by bin/claude) so parallel containers don't share
# files. Skipped on resumed containers, which already have their copy.
if [ -d /src ] && [ ! -e /workspace/.git ]; then
	echo "Copying working tree from host snapshot..."
	tar -C /src \
		--exclude=./node_modules --exclude=./dist \
		--exclude=./.wrangler --exclude=./.astro \
		-cf - . | tar -C /workspace -xf -
fi

# node_modules lives in this container's own filesystem (the host's
# darwin-arm64 binaries like workerd can't run here); the shared npm cache
# volume keeps installs fast. Install when missing or stale.
if [ -f /workspace/package-lock.json ]; then
	if [ ! -f /workspace/node_modules/.package-lock.json ] \
		|| [ /workspace/package-lock.json -nt /workspace/node_modules/.package-lock.json ]; then
		(cd /workspace && npm ci)
	fi
fi

exec "$@"
