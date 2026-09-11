# Durable ingestion-health production acceptance — 2026-09-11

PR [392](https://github.com/couetilc/news/pull/392), reviewed at exact head
`bdea6a381991e9877723b94e5bf8b2a4788818cd`, passed its unit, browser and mutation
checks. It merged at **14:12:35 UTC** as
`57a5f5947875611fd04fe99256e60d578184a1aa`. The corresponding
[main CI deployment](https://github.com/couetilc/news/actions/runs/34608768044)
completed successfully at **14:14:20 UTC**.

This acceptance task used only read-only production queries. It did not deploy,
force ingestion, change schedules, or modify auth, users, sessions or read state.

## Migration 0008

Before deployment at 14:09 UTC, neither new table existed and migration 0008
was absent from `d1_migrations`. At **14:15:02 UTC**, production recorded
`0008_ingestion_health.sql`; both expected schemas were present:

- `feed_health`: 13 columns covering attempt/completion, observed HTTP status,
  last successful/clean checks, and retained error/anomaly resolution history.
- `ingest_runs`: seven columns covering run identity, separate start/completion,
  polled/failed/anomalous feed counts and batch error.

At that point there were no tracked runs and no per-feed health records. This
was expected initialization immediately before the first new-version cron.

## Natural scheduled run

The **14:15 UTC** scheduled invocation produced run **#1**:

| Field | Production value |
|---|---|
| Started | 14:15:51 UTC |
| Finished | 14:15:54 UTC |
| Feeds polled | 1 |
| Failed feeds | 0 |
| Anomalous feeds | 0 |
| Batch error | None |

IEEE Spectrum was the one due source. Its new durable record shows:

| Field | Production value |
|---|---|
| Feed | `https://spectrum.ieee.org/feeds/feed.rss` |
| Attempt started | 14:15:51 UTC |
| Finished, last success and last clean parse | 14:15:53 UTC |
| Observed HTTP status | 200 |
| Consecutive failures | 0 |
| Unresolved error/anomaly | None |
| Next scheduled poll | 16:15:51 UTC |

Historical Workers Logs corroborate this at **14:15:54.113 UTC**:
`ingest.poll`, `source=ieee-spectrum`, `status=200`, `outcome=ok`, **30 parsed
items and zero inserts**. An unchanged article set correctly still records a
successful poll and clean parse.

The indexed-log query covered **14:14:20–14:17:33 UTC** and returned that one
ingestion record, with **zero ingestion errors or anomalies**. This verifies
one natural production run, not every possible failure/recovery path; those
remain covered by the repository's hermetic tests and separate live probes.

## Active state and untracked history

At **14:16:46 UTC**, reconciliation against the 32 configured `SOURCES` found:

- **32 active feeds present** and four retired endpoint rows excluded.
- **Zero active failure streaks**, unresolved recorded errors or anomalies.
- **Zero feeds overdue beyond the application's 30-minute grace period**.
- **One source with new per-feed tracker history; 31 awaiting their next
  scheduled poll**.

Those 31 sources lack history in the newly introduced tracker. They are not
31 failed feeds: their established scheduling rows have zero failures, and
none is overdue. Their new attempt/success/error history will populate at
their existing individual polling cadence; no forced sweep was performed.

The earlier [source-repair acceptance](2026-09-11-production-acceptance.md) includes actual successful
Intel/Owenomics/DeepSeek polls, preservation of all 34 original Intel items and
four read-history rows, and healthy Meta AI ingestion with Muse Voice Transcribe.

## Retained sanitized evidence

- `/tmp/news-improvements/prod-health-summary.json`
- `/tmp/news-improvements/prod-health-ingestion-events.json`
- `/tmp/news-improvements/prod-health-current.json` (schema/run/feed metadata;
  no auth, user, session or read-state rows)

Public status/browser/cache/privacy checks were independently handled by the
root task. The acceptance watcher made no changes to production or GitHub;
this document preserves its sanitized findings.
