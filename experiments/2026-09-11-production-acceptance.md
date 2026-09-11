# Feed repair production acceptance — 2026-09-11

PR [390](https://github.com/couetilc/news/pull/390) merged at **13:48:33 UTC** as
`e9900ef99d46cfb335c5e5273f4e205f4a9166fb`. Required unit and browser checks
passed; the browser run reported 26 passing tests. The corresponding
[main CI deployment](https://github.com/couetilc/news/actions/runs/34606441034)
completed successfully at **13:50:50 UTC**. The public `/status/` page then
reported that exact commit.

All application SQL in this verification was read-only. No manual ingestion,
production application deploy, source-state update, or schedule change was
performed by the acceptance watcher. The replacements first ran on the natural
**14:00 UTC** scheduled invocation.

## Actual production polls

| Source | Logged poll time (UTC) | HTTP | Consecutive failures | Parsed entries | New items | Total stored items |
|---|---|---:|---:|---:|---:|---:|
| Intel | 14:00:54.843 | 200 | 0 | 184 | 3 | 37 |
| Owenomics | 14:00:56.585 | 200 | 0 | 20 | 0 | 20 |
| DeepSeek | 14:00:58.505 | 200 | 0 | 21 | 5 | 5 |

Workers Logs records `ingest.poll`, `outcome=ok`, and the current configured URL
for each row above. Intel's archive/filter/deduplication reduces 184 repeated
card occurrences to three new September articles. DeepSeek's fixed initial
cutoff yields five current announcements, including **DeepSeek-V4.1-Flash
Release**. Owenomics' 20 canonical article URLs were already stored; no later
essay is currently in the official listing, so zero inserts is the expected
successful result.

The telemetry query inspected **13:46:00–14:03:07 UTC**, returning five ingestion
records in total: all `ingest.poll`, with **zero `ingest.error` or
`ingest.anomaly` records**. Three are the replacement polls above. This is a
bounded post-deployment observation, not a guarantee about future upstream
availability. The first query immediately after the tick did not yet show its
logs; the subsequent query did, so D1 and indexed logs were reconciled before
claiming acceptance.

## Existing Intel data preserved

A baseline was captured before deployment: **34 Intel items and four
read-history rows**. Comparisons both after migration and after the first
scheduled ingestion confirmed:

- All 34 original rows now have their independently verified canonical URLs.
- All original item IDs, guids, titles, publication timestamps and fetch
  timestamps are unchanged.
- The four existing read-history rows and their aggregate timestamp are
  unchanged. No user identifiers are included in this report.
- Exactly three new Intel items were added, yielding 37 total.

## Overall active registry and Meta AI

At **14:01:00 UTC**, reconciling D1 against all **32 configured `SOURCES`** found:

- 32 active feed rows present; no missing first polls.
- Zero active sources with a nonzero failure streak.
- Zero feeds currently due, and zero overdue beyond one 15-minute cron interval.
- Four retired D1 rows excluded from active health: the old Cisco EDGAR Atom
  endpoint, Intel RSS, Owenomics Sitecore API, and DeepSeek OpenRSS. The retired
  broken URLs still retain historical failure streaks of 11, 11 and 37;
  those are not failures of the replacement feeds.

Meta AI's current configured `https://research.meta.ai/` row has **HTTP 200,
zero consecutive failures**, and **10 stored posts**, including
[Introducing Muse Voice Transcribe](https://research.meta.ai/blog/introducing-muse-voice-transcribe).
Its next scheduled poll is **14:30:57 UTC**; the six-hour cadence remains intact.

## Local evidence files

Sanitized aggregate/public-article snapshots:

- `/tmp/news-improvements/prod-feed-health-summary.json`
- `/tmp/news-improvements/prod-feed-ingestion-events.json`
- `/tmp/news-improvements/prod-configured-feeds.json`

The before/after D1 responses were retained locally for identity comparison;
they contain public article data and aggregate read-history values, without
user identifiers. This report preserves the sanitized conclusions; temporary
local evidence paths are not required to operate the application.
