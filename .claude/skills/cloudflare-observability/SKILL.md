---
name: cloudflare-observability
description: Diagnose this Worker's production ingestion and deployment using owner health, D1 state, structured logs, and bounded historical queries.
---

# Production observability

Worker `news`, account `dbaa50e60c18b19d483578c42d9bb3ee`. Inspect current
`wrangler.jsonc` for cron and observability configuration. Start with the owner
Feed health page, then narrow to the failing source/run. Follow
[Authorization](../../../CLAUDE.md#authorization); no external alerts or new
observability services are enabled as a side effect of diagnosis.

## Triage

1. `/status` is SSR and session-adaptive. Public responses expose deployment
   metadata only; owner health responses are `private, no-store`. Verify the
   deployed commit before attributing a symptom to local code.
2. Match D1 `feeds`/`feed_health` against current `SOURCES`: include active
   entries with no state and distinguish retired endpoints. A source without
   new articles may be quiet; latest insertion is not latest successful poll.
3. Compare attempt/finish, response, last success/clean parse, errors/anomalies
   and resolution times. `feeds.last_status` is legacy validator history, not
   necessarily the latest attempt response. Started but unfinished is pending;
   the health UI calls it interrupted after two minutes. Overdue starts 30
   minutes after its scheduled check.
4. Inspect `ingest_runs` start/finish and per-feed error/anomaly totals. A
   platform invocation can succeed while individual feed errors were caught.
   Last-started identity matters when runs overlap; 192 runs are retained.
5. Use structured logs for details. Report the checked window, active scope,
   unresolved errors and any missing/truncated evidence, not "everything is
   perfect" based on a successful HTTP response.

A 304 resolves a failed-check streak but not a previous parse anomaly; only a
fresh clean parse resolves the anomaly. Error/anomaly text can remain after
resolution, with occurrence/resolution timestamps. Item freshness is per
source, because items are not attributed to individual endpoints.

## Logs and bounded fetching

`src/lib/log.ts` emits object records via `console.*`, with a typed dotted
`event` and scalar fields. Pass objects rather than pre-stringifying them.
Current ingest events are `ingest.poll`, `ingest.error`, `ingest.anomaly`; the
read endpoint emits `read.toggle`. Use the type union and call sites for fields.
Avoid logging page hits, credentials, headers, cookies or article bodies.

`npx wrangler tail --search ingest.poll` is live-only. It cannot establish past
health. Use Workers Logs for history; the existing tooling credential and a
sanitized query recipe are described in
[historical queries](references/historical-queries.md). Inspect errors
selectively, not raw visitor/event envelopes.

`fetchFeed` enforces one 20-second deadline across headers, streaming and custom
loader requests, plus an 8MiB decoded-body cap. Every custom loader request must
use its supplied bounded transport. Size checks count streamed bytes; a hung
cancellation must not block the next feed. Independent raw counters and parse
validation flag drift; an anomaly can coexist with a successful poll.

## Additional services

Workers Logs and durable D1 health are configured. Logpush and Analytics Engine
are not. Before recommending retention, sampling, pricing or new services,
verify current Cloudflare documentation and the actual account configuration;
those vendor facts are not permanent repo invariants. A denied query does not
authorize widening token scopes.

The dashboard convenience link is built from account and Worker name at
`/workers/services/view/<worker>/production/observability`. It is not a stable
API; recheck routing when a link fails. Operational links/details belong in the
owner-only status response.
