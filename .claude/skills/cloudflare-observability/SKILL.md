---
name: Cloudflare observability
description: How to inspect this Worker's production logs and metrics on Cloudflare — Workers Logs vs Logpush vs tail consumers vs Analytics Engine, the structured-log helper and event conventions, head sampling and retention tradeoffs, wrangler tail / Logs-UI query tips, and the observability dashboard deep-link convention.
when_to_use: Inspecting production logs or metrics; debugging ingest failures or a deploy; deciding what/how to log from a Worker; filtering or aggregating logs by source/status/event; questions about log retention, sampling, or durable history (Logpush/R2); adding a new structured-log call site; building a link to the observability dashboard; choosing between Workers Logs, Logpush, tail consumers, and Analytics Engine.
---

# Cloudflare observability

How to see what the `news` Worker is doing in production, and how this repo
emits logs so they're actually queryable. Read this before adding a log line or
debugging a production issue.

Facts for this Worker:

- Worker name: `news` (`wrangler.jsonc` `name`).
- Account id: `dbaa50e60c18b19d483578c42d9bb3ee` (connor@couetil.com).
- `observability.enabled: true` in `wrangler.jsonc` — Workers Logs is on. No
  `head_sampling_rate` is set, so sampling defaults to 100% (every invocation's
  logs are captured).

## The four observability surfaces

Cloudflare offers several overlapping things. What each is for:

| Surface | What it is | Retention | Cost | Use it for |
|---|---|---|---|---|
| **Workers Logs** | Structured logs from `console.*`, auto-indexed, queryable in the dashboard and `wrangler tail`. Enabled via `observability.enabled`. | Short (days; plan-dependent) | Included (events-based, generous free tier) | Day-to-day: "did the cron run?", "which feed 500'd?" |
| **`wrangler tail`** (tail consumer) | Live stream of invocations to your terminal. A "tail consumer" is the same mechanism a Worker can subscribe to. | None (live only) | Free | Watching a deploy or a cron tick in real time |
| **Logpush** | Batched export of logs to an external sink (R2, etc.) for durable history. **Not configured here.** | As long as you keep the files | R2 storage + Logpush (paid feature) | Long-term audit / analytics beyond the Logs window |
| **Analytics Engine** | A binding you `writeDataPoint()` to for high-cardinality time-series metrics, queried via SQL API. **Not configured here.** | Long | Paid binding | Custom metrics/dashboards (e.g. per-source item counts over months) |

Default to **Workers Logs** for this repo. Durable history (Logpush → R2) and
custom metrics (Analytics Engine) are deliberately *not* set up — if a need for
them arises, file an issue rather than reaching for them ad hoc.

## How we log: structured records, not strings

The helper lives at `src/lib/log.ts`. It is a thin, dependency-free wrapper over
`console.*` (workerd has no Node logging libraries; the 100%-coverage and
no-network rules make anything heavier the wrong size).

```ts
import { log } from '../lib/log';
log.info('ingest.poll', { source, feed, status: 200, items, inserted, outcome: 'ok' });
log.error('ingest.error', { source, feed, err: String(err) });
```

**Why objects, never `JSON.stringify(...)` first.** Workers Logs indexes the
*top-level fields* of the object you pass to `console.*`. Pass an object and you
can filter/aggregate by `source`, `status`, `event`, etc. in the Logs UI.
Pre-stringify it and the whole thing lands as one opaque `message` field — no
filtering. So the helper passes the record object straight through.

What the helper adds centrally:

- `level` — `'info'` (→ `console.log`) or `'error'` (→ `console.error`). The
  level both picks the console method (so errors surface in the Logs error
  stream) and is emitted as a filterable field.
- `event` — a dotted, namespaced name. This is the primary axis you filter on.

### Event-naming conventions adopted here

`namespace.action`, lowercase, dotted. Current events (the `LogEvent` union in
`src/lib/log.ts` is the source of truth):

| `event` | Level | Fields | Meaning |
|---|---|---|---|
| `ingest.poll` | info | `source`, `feed`, `status`, `outcome`, plus `items`+`inserted` on 200 | A feed was polled. `outcome: 'ok'` (200, with counts) or `'not_modified'` (304). |
| `ingest.error` | error | `source`, `feed`, `err` | A feed fetch/parse/store failed (one feed; the tick continues). |
| `ingest.anomaly` | error | `source`, `feed`, `kind`, `rawCount`, `parsedCount`, `missingFields`, `invalidCount` | Shape drift on a 200 poll (#78): the payload parsed to a suspicious shape. Filter by `kind` — `zero_parsed_of_raw` (raw entries present but 0 parsed — the smoking gun), `parse_drop` (kept <50% of raw entries), or `missing_required_fields` (parsed items with an empty guid/url/title or implausible date). Distinct from a legitimately empty feed, which emits no anomaly. Informational: the poll still succeeds and stores whatever parsed, so it never aborts the feed or its peers. |
| `read.toggle` | info | `userId`, `id`, `read` | A digest item was marked read (`read: true`) or unread (`read: false`), scoped to the session user (#70). Filter by `userId` for one user's toggles. |

Add a new event by extending the `LogEvent` union and using the same field
style. Keep field values JSON-scalar (string/number/boolean/null) so they index.

### Request-path logging decision

We deliberately do **not** log every page hit — page views are high-volume and
add cost/noise for little value. What we log on the request path:

- The one mutation, `read.toggle`, in `src/pages/api/read.ts`.
- Errors are left to the platform: unhandled exceptions and non-2xx are already
  captured by Workers Logs / the dashboard's invocation status, so we don't
  hand-log them per request.

`src/worker.ts` delegates `fetch` straight to Astro's handler and stays
logging-free by design; the loggable events live at the leaf call sites.

## Reading logs in production

### `wrangler tail` (live)

```sh
npx wrangler tail                       # stream all invocations
npx wrangler tail --format pretty       # human-readable
npx wrangler tail --status error        # only failed invocations
npx wrangler tail --search ingest.poll  # text-match the structured payload
```

Tail is live-only — it shows nothing that happened before you started it. To
catch the next cron tick, start tail and wait (the cron is `*/15 * * * *`).

### Workers Logs UI (historical, queryable)

In the dashboard, open the Worker → **Logs** (Observability) tab. Because we log
objects, you can add filters on the indexed fields, e.g.:

- `event = ingest.error` — every feed failure.
- `event = ingest.anomaly` — every shape-drift signal; add `AND kind = zero_parsed_of_raw` for the smoking gun (a feed that parsed nothing from a non-empty payload — a parser to fix).
- `event = ingest.poll AND outcome = not_modified` — which feeds 304'd.
- `source = cf` — everything about one source.
- `status = 200 AND items > 0` — polls that actually brought in items.

This is the payoff of object-form logging: none of these filters are possible on
free-text strings.

### Head sampling & retention tradeoffs

- **Head sampling** (`observability.head_sampling_rate`, 0–1) decides what
  fraction of invocations get logged at all. Unset here ⇒ 100%. Lower it only if
  log volume/cost becomes a problem; at this Worker's traffic it's a non-issue.
- **Retention is short** for Workers Logs (days, plan-dependent). For durable
  history you need **Logpush → R2**, which is not configured. The tradeoff: it's
  the only way to keep logs beyond the window, but it adds R2 storage cost and a
  paid feature. Treat anything you might need to audit months later as not
  guaranteed to survive in Workers Logs — file an issue to add Logpush if/when
  that need is real.

## Observability dashboard deep-link convention

The per-Worker observability page is reachable at a URL built from the account
id and the Worker name (cross-ref #43, which links the status page to it):

```
https://dash.cloudflare.com/<account_id>/workers/services/view/<worker-name>/production/observability
```

For this Worker:

```
https://dash.cloudflare.com/dbaa50e60c18b19d483578c42d9bb3ee/workers/services/view/news/production/observability
```

**Caveat:** this URL shape is **not part of any documented, stable API** — it's
the current dashboard routing, which Cloudflare can change without notice. It's
fine to construct it for a convenience link (built from `account_id` in
`wrangler.jsonc` + the Worker `name`), but don't depend on it
programmatically, and re-verify it if a link ever 404s.
