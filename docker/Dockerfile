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

ENTRYPOINT ["agent-entrypoint"]
CMD ["claude", "--dangerously-skip-permissions", "--effort", "xhigh"]
