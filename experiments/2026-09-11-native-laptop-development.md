# Native laptop development acceptance — issue #366

Implemented the approved native-laptop scope. `.envrc` leaves PATH alone;
containers remain explicitly available through `./.agent/bin/agent`.
`CLAUDE.md`, the environment skill and `.env.example` now describe native
setup, worktree-local state, actual git authentication and both required CI
checks. Wrapper comments and `.agent/README.md` no longer claim that the
`command` builtin bypasses an executable earlier on PATH.

## Verified locally

Fresh worktree: `/private/tmp/news-native-laptop`, branch
`codex/native-laptop-development`, starting from `7f84ac1`.
Node 24.10.0, direnv 2.37.1; no Docker command was launched.

- `npm ci` installed the locked dependencies in the fresh worktree.
- `npm run db:migrate:local` applied all eight migrations to that worktree's
  own `.wrangler/state/v3/d1`.
- `npx playwright install chromium` succeeded with the pinned browser.
- Generated an ignored, mode-0600 `.dev.vars` with a fresh local-only pepper;
  no production or other worktree credentials/state were copied.
- `npm run dev -- --host 127.0.0.1 --port 44321` served the app. Inspected the
  actual browser UI: newspaper masthead, pinned references and the expected
  empty-feed state of a fresh database.
- `npm test`: **865 tests / 66 files passed**, with **100%** statements
  (1326), branches (834), functions (257) and lines (1186).
- `npm run test:e2e`: **28 passed**, including signup, session persistence,
  owner/public health, feed interactions and state isolation. The harness
  built its worker and owned its separate runtime, state and port.
- Fingerprinted all 55 existing files in the original checkout's
  `.wrangler/state` plus `.dev.vars` before testing; all 55 were byte-for-byte
  unchanged afterward. Existing dev listeners were left running.
- Live `protect-main` ruleset requires both `test` and `e2e`.
- `git diff --check` passed. No dependency or workflow changes.

## Reproducing the PATH check

In an isolated direnv configuration (temporary `DIRENV_CONFIG`, removed after
verification), ran `direnv allow .`, then:

```sh
direnv exec . /bin/bash --noprofile --norc -c 'command -v codex; command -v claude'
```

Results were the installed native executables:

```text
/opt/homebrew/bin/codex
/Users/connorcouetil/.local/bin/claude
```

Also reproduced an already-active old entry in a temporary directory:
`PATH_add /private/tmp/news-native-laptop/.agent/bin`, `direnv allow .`, then
`eval "$(direnv export bash)"`. Resolution selected the container shim.
Replaced that entry with the new comment-only `.envrc`, allowed/reloaded it,
and both commands returned to their native paths. The reproduction must let
file mtime cross a second between writes: direnv 2.37.1 does not detect two
changes within the same one-second timestamp tick. No real shell profiles or
persistent direnv allow records were changed by these checks.

For an existing checkout, authorize the changed entry with `direnv allow`
and let the interactive shell reload it. Global/profile PATH overrides need
their own removal; the repo cannot undo unrelated shell configuration.

## Delivery

The implementation PR closes #366 via `Fixes #366`. Verify both required
checks on the PR head, then the main-branch deploy run and the production page.
Those durable outcomes are recorded on the PR rather than predicting a merge
SHA in this pre-merge acceptance record.
