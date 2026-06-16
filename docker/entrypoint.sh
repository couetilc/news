#!/bin/bash
# Bootstrap the agent container, then exec the requested command. Default:
# claude --dangerously-skip-permissions (see Dockerfile CMD / bin/claude); the
# bin/codex launcher sets AGENT_KIND=codex and runs `codex` instead. Setup that
# is identical for both agents (git, clone, npm) is shared; the agent-specific
# CLI config + auth is branched on $AGENT_KIND below.
set -e

# Which agent this container runs (bin/claude / bin/codex inject it; default
# claude so a bare `docker run news-agent` and `--shell` behave as before).
AGENT_KIND="${AGENT_KIND:-claude}"

# Git identity comes from the host via bin/<agent>; fall back to repo owner.
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

# ── Agent-specific CLI setup ─────────────────────────────────────────
if [ "$AGENT_KIND" = "codex" ]; then
	# Codex config + auth (parity with the claude branch below). CODEX_HOME
	# defaults to ~/.codex. Seed the model + reasoning effort; bin/codex also
	# passes both as flags — the reliable source of truth, since config.toml
	# effort can be ignored on a fresh launch (openai/codex#17436) — but the file
	# documents the pin and covers any path that reads it. Also mark the fresh
	# clone at /workspace trusted so Codex loads repo-local guidance immediately
	# instead of stopping on the first-run trust UI.
	mkdir -p "$HOME/.codex"
	{
		printf 'model = "%s"\n' "${CODEX_MODEL:-gpt-5.5}"
		printf 'model_reasoning_effort = "xhigh"\n\n'
		printf '[projects."/workspace"]\n'
		printf 'trust_level = "trusted"\n'
	} > "$HOME/.codex/config.toml"
	# Auth. Primary: the host's `codex login` credential (OAuth against the
	# ChatGPT plan — billed to the subscription, no per-token API charge),
	# injected base64-encoded by bin/codex because auth.json is multi-line JSON
	# that --env-file can't carry. This mirrors claude's CLAUDE_CODE_OAUTH_TOKEN
	# (a host-generated subscription credential). Fallback: OPENAI_API_KEY for
	# pay-as-you-go API billing. Never block startup.
	if [ -n "${CODEX_AUTH_B64:-}" ]; then
		# `if` consumes the decode's exit status, so a bad blob never aborts start.
		if printf '%s' "$CODEX_AUTH_B64" | base64 -d > "$HOME/.codex/auth.json"; then
			chmod 600 "$HOME/.codex/auth.json"
		fi
	elif command -v codex >/dev/null 2>&1 && [ -n "${OPENAI_API_KEY:-}" ]; then
		codex login --api-key "$OPENAI_API_KEY" >/dev/null 2>&1 || true
	fi
else
	# Refresh the claude CLI before the session starts (native install under
	# ~/.local is node-owned, so this works without root). Never block startup.
	claude update 2>&1 | tail -1 || true

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
fi

# Surface identity: container-scoped global instructions, auto-loaded into
# context by every session in here. Written to each agent's global path
# (claude: ~/.claude/CLAUDE.md; codex: ~/.codex/AGENTS.md) and overwritten each
# start so updates propagate.
case "$AGENT_KIND" in
	codex) AGENT_GLOBAL_INSTRUCTIONS="$HOME/.codex/AGENTS.md" ;;
	*)     AGENT_GLOBAL_INSTRUCTIONS="$HOME/.claude/CLAUDE.md" ;;
esac
mkdir -p "$(dirname "$AGENT_GLOBAL_INSTRUCTIONS")"
cat > "$AGENT_GLOBAL_INSTRUCTIONS" <<'EOF'
# Surface: news agent container

You are running inside the isolated agent container for the news repo
(`./bin/claude` for Claude, `./bin/codex` for Codex; both
--dangerously-skip-permissions / --yolo).

- /workspace was cloned fresh from GitHub at container start — you begin on
  `main`; create a branch before committing.
- Pre-installed: node (already matches the repo's pin), npm, git, gh,
  gitleaks, shellcheck, actionlint, ripgrep (rg). mise is NOT
  available here — skip any mise commands.
- Never commit on main. Changes reach production only via PR → CI → merge.
- The host machine is unreachable. Nothing outlives this container except
  what you push — commit and push early and often.
- The backlog lives in GitHub issues: `gh issue list`.

## Missing a tool?

You run as non-root: `apt install` is impossible mid-session. The policy:

1. **Ephemeral first**: for a one-off need, use user-space installs — `npx`,
   an npm devDependency, or a binary downloaded to `~/.local/bin`. These die
   with the container; never edit the container definition for a tool you
   have needed once.
2. **Rule of two → raise an issue, don't self-edit the image**: when a tool
   is needed *again* (or is plainly load-bearing), don't edit
   `docker/Dockerfile` this session — open an issue requesting it
   (`gh issue create`). That surfaces it asynchronously while keeping the
   image change human-gated: note in the issue that implementing it needs an
   explicit human go-ahead before the Dockerfile PR is merged.
3. **Justify in place**: every package added to the Dockerfile gets a
   one-line comment naming the workflow that needs it, so a future session
   can safely remove it when that workflow disappears.
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
