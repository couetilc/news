# Meta AI source verification

Verified 2026-09-11 UTC (2026-09-10 in America/Chicago).

- `https://research.meta.ai/` returns HTTP 200 and server-renders ten article
  cards, including the September 1 Muse Voice Transcribe announcement.
- No RSS/Atom alternate is declared. `https://ai.meta.com/blog/rss/` returns
  HTTP 404, so that often-listed URL is not a usable subscription.
- The homepage has both featured and regular cards. Featured placement is not
  chronological; use each card's `time[dateTime]` publication date.
- Two older cards still link to `https://ai.meta.com/blog/...`. Both that origin
  and `https://research.meta.ai/blog/...` are accepted; other origins are rejected.
- The source polls every six hours, imports the small listing in full, and
  links out for article text. Existing ingest field and raw-count checks expose
  page-shape drift. Generated CSS class names are not part of the parser contract.

## Reproduce

```sh
node experiments/verify-meta-ai.mjs
TZ=UTC npm test
npm run test:e2e -- e2e/meta-ai-source.spec.ts
```

The live probe uses the production parser, performs no writes, and stays outside
the hermetic unit suite. At verification it reported HTTP 200, 10 raw / 10 parsed
posts, no missing titles or dates, and the correct Muse Voice Transcribe URL and
publication timestamp (`1788220800`). The reduced fixture retains the real
semantic card markup and both ordinary and non-breaking title spaces.

The unit suite passed 775 tests at 100% statements, branches, functions and
lines. The browser regression failed against the previous display registry
(the filter exposed `meta-ai` rather than `Meta AI`) and passed with the change:
on a 390px viewport the Meta AI chip filters the feed to the correct article,
with its AI desk mark and official destination. Before/after captures accompany
the PR; screenshot files are not committed.

Local caveat: an existing TI date-parser test fails under America/Chicago
because `Date.parse('09 Jun 2026')` uses local midnight. UTC matches CI and
workerd. Meta's ISO date-only values parse as UTC in both environments.
