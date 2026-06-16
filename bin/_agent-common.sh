#!/bin/bash
# Shared launcher for the isolated agent containers (bin/claude, bin/codex).
#
# Each wrapper sets a few variables and defines agent_cmd(), then sources this
# file and calls `agent_launch "$@"`. Everything identical across agents — the
# isolation contract, .env/token preflight, sync_main, image build, dev-server
# port mapping, and the docker run scaffolding (most of the launcher's ~120
# lines) — lives here, so the two entrypoints stay DRY while remaining separate,
# typeable commands (`claude` and `codex`).
#
# Isolation contract: NOTHING from the host is mounted. The container clones the
# repo fresh from GitHub at launch (so hand it in-progress work by committing
# first — the post-commit hook auto-pushes the branch). Parallel containers
# share nothing but an npm cache. Work leaves the container only via git:
# commits are gitleaks-gated (.git-hooks/pre-commit, binary baked into the
# image) and auto-pushed (.git-hooks/post-commit). Tokens are injected as
# environment variables from .env (see .env.example).
#
# Containers are kept after exit (not --rm) so unpushed work is recoverable:
# resume with `docker start -ai <name>` (this begins a NEW agent session in the
# same workspace — use the agent's resume command inside to pick up the previous
# one), salvage files with `docker cp`. `--clean` removes exited containers and
# rebuilds the image from scratch so the baked CLIs don't freeze at
# image-build-time latest.
#
# Wrapper contract — set these before calling agent_launch:
#   AGENT_KIND            "claude" | "codex"; names messages, the container, and
#                         the $AGENT_KIND the entrypoint branches on.
#   AGENT_ENV             array of extra `-e VAR[=value]` args to inject (may be
#                         empty). A bare `-e VAR` passes VAR through from this
#                         script's environment, keeping secrets off the argv.
#   agent_auth_preflight  function; called only when launching the real agent
#                         (not --shell/--clean); errors+exits if the agent has no
#                         usable credential. May also append to AGENT_ENV.
#   agent_cmd()           given the user's args, sets the CMD array run in-container.

IMAGE=news-agent

# Keep the host's main current with origin before building. The container clones
# app code fresh at launch, but the agent image is built from the local docker/
# context and we invoke the local bin/<agent> — both read from the host working
# tree, so a stale main means a stale agent setup. Fast-forward when we can;
# otherwise warn. This never blocks the launch: callers invoke it via
# `sync_main || true`, which suspends `set -e` for the whole function body.
sync_main() {
	git rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
	echo "Syncing main with origin..." >&2
	if ! git fetch --quiet origin main 2>/dev/null; then
		echo "  warning: couldn't reach origin (offline?); using local checkout as-is" >&2
		return 0
	fi
	local branch
	branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "")
	if [ "$branch" = "main" ]; then
		if git merge --ff-only origin/main >/dev/null 2>&1; then
			echo "  main fast-forwarded to origin/main" >&2
		else
			echo "  warning: local main won't fast-forward (diverged or dirty tree); continuing as-is" >&2
		fi
	elif git merge-base --is-ancestor main origin/main 2>/dev/null; then
		# On a feature branch: move the local main ref up to origin/main
		# without touching the current branch or working tree.
		git update-ref refs/heads/main origin/main
		echo "  main fast-forwarded to origin/main (on branch '$branch'; working tree untouched)" >&2
	else
		echo "  warning: local main has diverged from origin/main; leaving it unchanged" >&2
	fi
}

# Host port mapping. We pick the random host ports ourselves instead of using the
# bare `-p 127.0.0.1::4321` form (which lets Docker choose) so we can inject the
# resulting addresses into the container as $DEV_HOST_4321 / $DEV_HOST_8787. The
# agent runs as non-root with no Docker socket — by the isolation contract it
# cannot query the mapping itself — so it reads those vars and tells you which
# URL to open. Still a fresh random port per launch, so parallel containers never
# collide. (Bind only: the dev server must also bind 0.0.0.0 inside the
# container — run `npm run dev -- --host` — or forwarded traffic never reaches a
# container-loopback listener.)
port_free() {
	( exec 3<>"/dev/tcp/127.0.0.1/$1" ) 2>/dev/null && return 1 || return 0
}
pick_port() {
	local p
	while :; do
		p=$(( (RANDOM % 16384) + 49152 )) # ephemeral range 49152-65535
		if port_free "$p"; then echo "$p"; return; fi
	done
}

# The full launch flow. cd is relative to the *wrapper* ($0 stays the sourcing
# script through `source`), so this resolves the repo root for either entrypoint.
agent_launch() {
	cd "$(dirname "$0")/.." || exit 1

	if [ "${1:-}" = "--clean" ]; then
		local exited
		exited=$(docker ps -aq --filter label=news-agent --filter status=exited)
		if [ -n "$exited" ]; then
			# shellcheck disable=SC2086  # $exited is a list of ids; intentional split
			docker rm $exited
		else
			echo "no exited agent containers"
		fi
		echo "Rebuilding image from scratch (fresh claude/codex/gh/node)..."
		docker build --pull --no-cache -t "$IMAGE" docker/
		exit 0
	fi

	if [ ! -f .env ]; then
		echo "error: .env not found — copy .env.example and fill in tokens" >&2
		exit 1
	fi
	if ! grep -q '^GH_TOKEN=.\+' .env; then
		echo "error: GH_TOKEN is empty in .env — the container clones and pushes over HTTPS with it (see .env.example)" >&2
		exit 1
	fi

	sync_main || true

	# Build (or refresh) the agent image. The first build — and any after
	# `--clean` — downloads the toolchain plus a headless Chromium shell, so it
	# takes a few minutes; cached rebuilds finish in seconds. Either way, show
	# BuildKit's progress so a cold build reads as work-in-progress, not a hang.
	if docker image inspect "$IMAGE" >/dev/null 2>&1; then
		echo "Refreshing $IMAGE image (cached layers reused; usually seconds)..." >&2
	else
		echo "Building $IMAGE image for the first time: node/gh/gitleaks/claude/codex + headless Chromium (~150MB)." >&2
		echo "This is a one-time cost of a few minutes; later runs reuse the Docker cache." >&2
	fi
	local build_start=$SECONDS
	docker build -t "$IMAGE" docker/
	echo "Image ready in $((SECONDS - build_start))s." >&2

	# CMD is set either to a plain shell or by the agent's agent_cmd(). The agent
	# auth check runs only on a real launch — `--shell` just needs .env+GH_TOKEN,
	# matching the original behavior (poke around without agent credentials).
	CMD=()
	if [ "${1:-}" = "--shell" ]; then
		shift
		CMD=(bash "$@")
	else
		agent_auth_preflight
		agent_cmd "$@"
	fi

	local NAME
	NAME="news-agent-${AGENT_KIND}-$(date +%m%d-%H%M%S)"
	echo "Starting $NAME (kept after exit; ./bin/${AGENT_KIND} --clean to prune)" >&2

	local PORT_ASTRO PORT_WRANGLER
	PORT_ASTRO=$(pick_port)
	PORT_WRANGLER=$(pick_port)
	while [ "$PORT_WRANGLER" = "$PORT_ASTRO" ]; do PORT_WRANGLER=$(pick_port); done
	echo "Dev servers, once started inside with --host:" >&2
	echo "  astro     http://127.0.0.1:$PORT_ASTRO/    (\$DEV_HOST_4321)" >&2
	echo "  wrangler  http://127.0.0.1:$PORT_WRANGLER/    (\$DEV_HOST_8787)" >&2

	docker run -it \
		--name "$NAME" \
		--label news-agent \
		-v news-agent-npm-cache:/home/node/.npm \
		--env-file .env \
		-e AGENT_KIND="$AGENT_KIND" \
		"${AGENT_ENV[@]}" \
		-e GIT_USER_NAME="$(git config user.name 2>/dev/null || true)" \
		-e GIT_USER_EMAIL="$(git config user.email 2>/dev/null || true)" \
		-e TERM=xterm-256color \
		-e COLORTERM="${COLORTERM:-}" \
		-e DEV_HOST_4321="127.0.0.1:$PORT_ASTRO" \
		-e DEV_HOST_8787="127.0.0.1:$PORT_WRANGLER" \
		-p "127.0.0.1:$PORT_ASTRO:4321" -p "127.0.0.1:$PORT_WRANGLER:8787" \
		"$IMAGE" "${CMD[@]}"
}
