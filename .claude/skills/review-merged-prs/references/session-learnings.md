# Session Learnings

These lessons came from the initial in-context monitoring session for this repo.

- Split the watch by agent surface. On Claude Code, drive it as a harness
  background task, never a model-paced loop: launch the watcher with
  `run_in_background` so idle polls stay off the wake path (zero tokens), and a
  delta (exit `2`) re-invokes the agent exactly once with the payload. On Codex,
  do **not** assume Claude's `run_in_background` / `ScheduleWakeup` behavior:
  run detectors once per turn, run watchers in foreground/explicitly managed
  sessions, or deliberately use Codex app thread automations when available.
  Codex keeps determinism through the same markers, but ordinary foreground
  polling does not have Claude's zero-idle-cost guarantee. See SKILL.md "Watch
  mechanism".
- When a watcher or one-shot detector reports a delta, review the one batch,
  file any finding-issues, apply the `agent-reviewed` label (or bump the
  heavy-run marker with `--mark`), verify the detector is clean, then **re-arm
  the surface-appropriate watch before the turn ends**. On Claude this means
  re-launching background tasks; on Codex it means continuing the explicit
  detector/session/automation cadence. Re-arming is mechanical, not a remembered
  choice — a disarmed watch at turn-end is the failure mode this rework exists
  to prevent.
- For heavy runs (mutation/e2e/fuzz) there is no PR label to mark reviewed, so
  the idempotency marker is a per-kind last-reviewed-run-id file. First sight of
  a kind seeds the baseline silently — a first run has nothing to diff against;
  the signal is the *next* run's delta (baseline→delta, per #227).
- Always fast-forward local `main` before validating. PR diffs can miss
  interactions with previously merged work.
- If you fetched PR diffs before fast-forwarding, re-read the final files after
  the fast-forward. A parallel read can race with the merge and show stale
  pre-merge signatures or tests.
- Review generated artifacts when generation is part of behavior. A prerendered
  `/status` page built into a static login redirect because middleware ran
  during prerender.
- Check route variants when middleware allowlists exact paths. `/public` and
  `/public/` can differ under `trailingSlash: "ignore"`.
- Preserve URL state through form posts. Source filters and pagination links can
  be correct while `/api/read` still redirects toggles back to `/`.
- For source/feed PRs, run fixture tests and spot-check live shapes when safe.
  Real feeds exposed current shape details that fixtures alone could miss. Keep
  tests hermetic, but record useful live facts in the review: field presence,
  column lengths, kept-row counts, newest/oldest dates, and any mismatch between
  fixture assumptions and production payloads.
- Watch for first-poll backfills from APIs that are not windowed feeds.
  `data.sec.gov/submissions` can expose years of historical filings. If the
  risk is already tracked, update that issue with the new PR/live-shape context
  rather than filing a duplicate finding.
- For observability/logging changes, verify that structured logs preserve enough
  debugging detail, especially stack/cause data for caught errors.
- When a PR changes a policy, config gate, or public convention, search the repo
  for stale wording in README, CLAUDE.md, and skills. A green test gate does not
  catch documentation drift; README edits still need the repo's sign-off flow.
- Apply the `agent-reviewed` label to every PR you finish reviewing, even a clean
  one. That label — not a committed log — is how later runs tell reviewed PRs
  apart from new merges.
- Route actionable findings from **open PR reviews** into GitHub issues too.
  PR comments can get lost outside the backlog; the issue, or an existing issue
  comment when it is already covered, is the durable review record.
