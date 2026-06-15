# Isolated agent environment for this repo: everything a Claude Code session
# needs (node 24 matching mise.toml, git, gh, gitleaks, claude CLI), run as
# non-root — --dangerously-skip-permissions refuses to run as root. Nothing
# from the host is mounted: each container clones the repo from GitHub at
# launch (entrypoint, GH_TOKEN), so parallel containers never share files;
# work leaves only via git push.
FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
		git curl ca-certificates jq procps \
	&& curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
		-o /usr/share/keyrings/githubcli-archive-keyring.gpg \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
		> /etc/apt/sources.list.d/github-cli.list \
	&& apt-get update && apt-get install -y --no-install-recommends gh \
	&& rm -rf /var/lib/apt/lists/*

# gitleaks: version-matched to Connor's host (see .git-hooks/pre-commit).
ARG GITLEAKS_VERSION=8.29.0
RUN arch=$(dpkg --print-architecture) && case "$arch" in \
		amd64) gl_arch=x64 ;; arm64) gl_arch=arm64 ;; *) echo "unsupported arch $arch" && exit 1 ;; esac \
	&& curl -fsSL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${gl_arch}.tar.gz" \
		| tar -xz -C /usr/local/bin gitleaks \
	&& gitleaks version

# Playwright + headless Chromium for in-session UI/behavioral verification: the
# `verify`/`run` skills drive the local dev server in a real browser to watch a
# change behave (the launch that failed in #42 — Chromium needs system libs apt
# can't add mid-session as non-root). Remove this whole layer if browser
# verification is no longer wanted. Run as root (apt needs it) into a
# world-readable system path so the non-root `node` user finds the baked
# browser; `--only-shell` installs only the smaller chromium-headless-shell
# build (not full Chromium) to blunt the image-size tax. Pinned in lockstep with
# the `@playwright/test` devDependency (package.json) — bump both together, or
# Playwright errors and re-downloads at runtime. Non-root Chromium in a
# container needs `--no-sandbox` at launch (see CLAUDE.md / agentic-environments).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ARG PLAYWRIGHT_VERSION=1.61.0
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps --only-shell chromium \
	&& rm -rf /var/lib/apt/lists/* \
	&& chmod -R a+rX /ms-playwright

COPY entrypoint.sh /usr/local/bin/agent-entrypoint
RUN chmod +x /usr/local/bin/agent-entrypoint

# Pre-create dirs owned by `node`: /workspace receives the clone, and the
# npm cache mountpoint must not end up root-owned when the volume is fresh.
RUN mkdir -p /workspace /home/node/.claude /home/node/.npm \
	&& chown -R node:node /workspace /home/node/.claude /home/node/.npm

USER node
WORKDIR /workspace

# claude CLI via the native installer, owned by `node` (~/.local) so the
# entrypoint can run `claude update` before each session. Mid-session
# auto-update stays off for predictability — refresh happens at start.
ENV PATH="/home/node/.local/bin:${PATH}"
RUN curl -fsSL https://claude.ai/install.sh | bash
ENV DISABLE_AUTOUPDATER=1
# Marks this as a sandboxed environment for claude (kept as verified
# working config). The --dangerously-skip-permissions acceptance dialog is
# pre-accepted via skipDangerousModePermissionPrompt in the seeded user
# settings — see entrypoint.sh.
ENV IS_SANDBOX=1

ENTRYPOINT ["agent-entrypoint"]
CMD ["claude", "--dangerously-skip-permissions", "--effort", "xhigh"]
