# Isolated agent environment for this repo: everything a Claude Code session
# needs (node 24 matching mise.toml, git, gh, claude CLI), run as non-root —
# --dangerously-skip-permissions refuses to run as root. The repo is bind-
# mounted at /workspace by bin/claude; nothing is COPYed in at build time.
FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
		git curl ca-certificates jq procps \
	&& curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
		-o /usr/share/keyrings/githubcli-archive-keyring.gpg \
	&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
		> /etc/apt/sources.list.d/github-cli.list \
	&& apt-get update && apt-get install -y --no-install-recommends gh \
	&& rm -rf /var/lib/apt/lists/*

ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}

COPY entrypoint.sh /usr/local/bin/agent-entrypoint
RUN chmod +x /usr/local/bin/agent-entrypoint

# Pre-create the named-volume mountpoints owned by `node`: fresh volumes
# inherit ownership from the image path, and root-owned volumes would break
# npm ci / claude state writes for the non-root user.
RUN mkdir -p /workspace/node_modules /home/node/.claude \
	&& chown -R node:node /workspace /home/node/.claude

USER node
WORKDIR /workspace

ENTRYPOINT ["agent-entrypoint"]
CMD ["claude", "--dangerously-skip-permissions"]
