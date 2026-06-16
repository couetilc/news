# Session Learnings

These lessons came from the initial in-context monitoring session for this repo.

- Stop the watch loop when a merge is detected. Review one batch, file any
  finding-issues, apply the `agent-reviewed` label, verify the detector is clean,
  then restart the loop.
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
