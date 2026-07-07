# .agent/Dockerfile — news's overlay on the @couetilc/agentic-coding base image.
#
# The base ships node, git, gh, gitleaks, ripgrep, uv, and the agent CLIs. This
# overlay re-adds the three tools news pulled from its old monolithic image but
# the package moved to project-choice territory (PLAN.md §5): shellcheck +
# actionlint for linting the repo's shell/CI assets, and Playwright + a headless
# Chromium shell for the verify/run skills' in-browser checks.
#
# The CLI injects the base image tag as the BASE build-arg (no version literal to
# drift). Build context is .agent/; the repo clone does NOT exist at build time —
# nothing here may reference repo files. Root/system deps only; user-space setup
# (npm ci) lives in init.sh, which runs as node after the clone.
ARG BASE
FROM ${BASE}

# apt needs root; the base image ends as USER node, so switch up first.
USER root

# shellcheck: lints the repo's shell scripts (.git-hooks are gone now, but
# scripts/*.sh and any workflow shell remain). curl/ca-certificates come from base.
RUN apt-get update && apt-get install -y --no-install-recommends shellcheck \
	&& rm -rf /var/lib/apt/lists/*

# actionlint: lints .github/workflows/*.yml so a bad workflow edit is caught here,
# not by a red CI run. Single static binary, arch-matched, from upstream releases.
ARG ACTIONLINT_VERSION=1.7.12
RUN arch=$(dpkg --print-architecture) \
	&& curl -fsSL "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_${arch}.tar.gz" \
		| tar -xz -C /usr/local/bin actionlint \
	&& actionlint -version

# Playwright + headless Chromium for in-session UI/behavioral verification (the
# verify/run skills drive the dev server in a real browser). Chromium needs
# system libs apt can't add mid-session as non-root, so bake them now. Installed
# into a world-readable system path so the non-root `node` user finds the baked
# browser; --only-shell installs the smaller chromium-headless-shell build.
# Keep PLAYWRIGHT_VERSION in lockstep with the @playwright/test devDependency in
# package.json, or Playwright re-downloads at runtime. Non-root Chromium needs
# --no-sandbox at launch (the container is already the sandbox).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ARG PLAYWRIGHT_VERSION=1.61.0
RUN npx -y playwright@${PLAYWRIGHT_VERSION} install --with-deps --only-shell chromium \
	&& rm -rf /var/lib/apt/lists/* \
	&& chmod -R a+rX /ms-playwright

# Back to the non-root user the base runs as (--dangerously-skip-permissions
# refuses root; the entrypoint and agent run as node).
USER node
