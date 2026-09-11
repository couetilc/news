# Optional execution surfaces

Read only when using a container or cloud session. Native laptop work does not
need Docker, injected agent credentials, a cloud VM, or browser shims. The
[central authorization policy](../../../../CLAUDE.md#authorization) applies.

## Agent container

Use explicit `./.agent/bin/agent claude`, `./.agent/bin/agent codex`, or
`./.agent/bin/agent shell`. Inspect `.agent/config.js`, `.agent/Dockerfile`,
`.agent/init.sh` and [.agent/README.md](../../../../.agent/README.md) for the
committed setup; do not change native PATH to route host CLIs through wrappers.

- Containers clone from GitHub and share no host checkout. Push a branch before
  handing it to a container. Commit and push work before disposal; inspect
  the active hooks instead of assuming delivery.
- The non-root image cannot install system packages during a session. Use an
  appropriate user-space tool or make an in-scope image change through the PR
  flow. Do not invent a mandatory second-use proposal gate.
- Port mappings are per container. Start Astro with `--host`, then use the
  printed `$DEV_HOST_ASTRO`; the host port need not be 4321. Baked Chromium and
  the Playwright dependency must match; the container launch requires
  `--no-sandbox` (already configured by the e2e harness).
- Injected credentials are readable by code in the container; filesystem
  isolation does not isolate those tokens or restrict network egress. Refer
  to `.env.example` and `.agent/env.example`; never print their secret values.
- For recovery, prefer the pushed branch. Inspect a kept container before
  cleanup and use `docker cp` to salvage required files. Restarting an old
  container can rerun its original command; it is not a safe generic resume.

## Claude cloud sessions

`scripts/session-start.sh` installs dependencies only when
`CLAUDE_CODE_REMOTE=true`. Check the actual runtime and network access; do not
assume fixed VM versions, tool inventory or vendor permissions. Cloud sessions
remain free of Cloudflare credentials and deliver by branch → PR → CI deploy.
A scoped GitHub proxy may permit only the session branch and lack GitHub API or
workflow-file access; use the available session UI or an authenticated local
session for the remaining delivery steps.

When the pinned browser is unavailable, inspect `scripts/pw-browser-shim.sh`.
It is a cloud-only fallback that uses preinstalled browser binaries, not exact
browser-version parity. CI installs the pinned browser. An unavailable or
mismatched browser must be reported as a validation limitation.

Consult current official platform docs when platform behavior matters:
[Claude cloud](https://code.claude.com/docs/en/claude-code-on-the-web),
[hooks](https://code.claude.com/docs/en/hooks#sessionstart),
[Wrangler](https://developers.cloudflare.com/workers/wrangler/).
