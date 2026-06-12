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

# Refresh the claude CLI before the session starts (native install under
# ~/.local is node-owned, so this works without root). Never block startup.
claude update 2>&1 | tail -1 || true

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

# First-run state for claude: mark onboarding, the bypass-permissions
# warning, and /workspace trust as completed so a fresh container drops
# straight into an authenticated session (CLAUDE_CODE_OAUTH_TOKEN). The
# native installer and `claude update` create ~/.claude.json themselves, so
# MERGE the flags — a write-if-absent guard never fires. The merge is
# idempotent on resumed containers; theme is defaulted only when unset.
flags='{"hasCompletedOnboarding": true, "bypassPermissionsModeAccepted": true, "projects": {"/workspace": {"hasTrustDialogAccepted": true}}}'
if [ -f "$HOME/.claude.json" ]; then
	jq --argjson flags "$flags" '. * $flags | .theme //= "dark"' "$HOME/.claude.json" \
		> "$HOME/.claude.json.tmp" && mv "$HOME/.claude.json.tmp" "$HOME/.claude.json"
else
	printf '%s\n' "$flags" | jq '.theme = "dark"' > "$HOME/.claude.json"
fi

# Default model: under setup-token auth the entitlement metadata
# under-reports, so the /model picker omits Fable and the `best` alias falls
# back to Opus — but explicit ids work and bill the Max subscription.
# Update the id here when a newer top model ships.
# skipDangerousModePermissionPrompt is the current key gating the
# --dangerously-skip-permissions acceptance dialog (claude migrated it here
# from ~/.claude.json's bypassPermissionsModeAccepted).
mkdir -p "$HOME/.claude"
if [ -f "$HOME/.claude/settings.json" ]; then
	jq '.model //= "claude-fable-5" | .effort //= "xhigh" | .skipDangerousModePermissionPrompt //= true' \
		"$HOME/.claude/settings.json" \
		> "$HOME/.claude/settings.json.tmp" && mv "$HOME/.claude/settings.json.tmp" "$HOME/.claude/settings.json"
else
	printf '{"model": "claude-fable-5", "effort": "xhigh", "skipDangerousModePermissionPrompt": true}\n' \
		> "$HOME/.claude/settings.json"
fi

# Surface identity: container-scoped user memory, auto-loaded into context by
# every claude session in here. Overwritten each start so updates propagate.
cat > "$HOME/.claude/CLAUDE.md" <<'EOF'
# Surface: news agent container

You are running inside the isolated agent container for the news repo
(`./bin/claude`, --dangerously-skip-permissions).

- /workspace was cloned fresh from GitHub at container start — you begin on
  `main`; create a branch before committing.
- Pre-installed: node (already matches the repo's pin), npm, git, gh,
  gitleaks. mise is NOT available here — skip any mise commands.
- Never commit on main. Changes reach production only via PR → CI → merge.
- The host machine is unreachable. Nothing outlives this container except
  what you push — commit and push early and often.
- The backlog lives in GitHub issues: `gh issue list`.
EOF

# node_modules lives in this container's own filesystem (no darwin binaries
# to clash with); the shared npm cache volume keeps installs fast.
if [ -f /workspace/package-lock.json ]; then
	if [ ! -f /workspace/node_modules/.package-lock.json ] \
		|| [ /workspace/package-lock.json -nt /workspace/node_modules/.package-lock.json ]; then
		(cd /workspace && npm ci)
	fi
fi

exec "$@"
