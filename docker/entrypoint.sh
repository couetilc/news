#!/bin/bash
# Bootstrap the agent container, then exec the requested command (default:
# claude --dangerously-skip-permissions, see Dockerfile CMD / bin/claude).
set -e

# Git identity comes from the host via bin/claude; fall back to repo owner.
git config --global user.name "${GIT_USER_NAME:-Connor Couetil}"
git config --global user.email "${GIT_USER_EMAIL:-connor@couetil.com}"

# All git traffic is HTTPS with GH_TOKEN as the credential (no SSH keys in
# here — that's the point). Rewrite any SSH remotes defensively.
git config --global url."https://github.com/".insteadOf "git@github.com:"
# Repo-versioned git lifecycle hooks (gitleaks pre-commit, auto-push on
# commit; see .git-hooks/).
git config --global core.hooksPath /workspace/.git-hooks
if [ -n "${GH_TOKEN:-}" ]; then
	gh auth setup-git 2>/dev/null || true
fi

# Each container clones its own working tree from the remote — no host
# mounts, so parallel containers share nothing and the host filesystem is
# unreachable. Skipped on resumed containers, which already have their clone.
NEWS_REPO="${NEWS_REPO:-couetilc/news}"
if [ ! -e /workspace/.git ]; then
	if [ -z "${GH_TOKEN:-}" ]; then
		echo "error: GH_TOKEN is required to clone ${NEWS_REPO} (set it in .env)" >&2
		exit 1
	fi
	echo "Cloning ${NEWS_REPO}..."
	git clone "https://github.com/${NEWS_REPO}.git" /workspace
fi

# node_modules lives in this container's own filesystem (no darwin binaries
# to clash with); the shared npm cache volume keeps installs fast.
if [ -f /workspace/package-lock.json ]; then
	if [ ! -f /workspace/node_modules/.package-lock.json ] \
		|| [ /workspace/package-lock.json -nt /workspace/node_modules/.package-lock.json ]; then
		(cd /workspace && npm ci)
	fi
fi

exec "$@"
