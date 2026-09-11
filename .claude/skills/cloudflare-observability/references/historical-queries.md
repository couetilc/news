# Historical Workers Logs queries

The supported [telemetry query endpoint](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/)
returns historical events without driving the dashboard. The existing local
tooling token can query it. Cloudflare lists **Workers Observability Write** as
an accepted permission for this endpoint; a token described as read-only may
not have it. Do not silently widen credentials when a query is denied.

Run this from the repo root on Node 24. `--env-file` loads the ignored tooling
credential without printing it. Inline parameters and `dry: true` make this an
ad-hoc query without saved query results. Timestamps are Unix **milliseconds**,
unlike the seconds stored in D1. This example requests only ingestion records
and prints a field allowlist, excluding the platform's visitor/request metadata.

```sh
node --env-file=.env --input-type=module <<'JS'
const account = 'dbaa50e60c18b19d483578c42d9bb3ee';
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not configured');
const to = Date.now();
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,
  {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      queryId: 'news-ingestion-health', dry: true, view: 'events', limit: 2000,
      timeframe: { from: to - 24 * 60 * 60 * 1000, to },
      parameters: { filterCombination: 'and', filters: [
        { key: '$metadata.service', operation: 'eq', type: 'string', value: 'news' },
        { key: 'event', operation: 'starts_with', type: 'string', value: 'ingest.' },
      ] },
    }),
  },
);
if (!response.ok) throw new Error(`Telemetry query HTTP ${response.status}`);
const data = await response.json();
if (!data.success || data.result?.run?.status !== 'COMPLETED') {
  throw new Error('Telemetry query did not complete successfully');
}
const events = data.result.events.events;
const fields = ['event', 'source', 'status', 'outcome', 'items', 'inserted', 'kind'];
for (const event of events) {
  const record = { at: new Date(event.timestamp).toISOString() };
  for (const key of fields) if (key in event.source) record[key] = event.source[key];
  console.log(JSON.stringify(record));
}
if (events.length >= 2000) {
  console.error('Possible truncation: narrow the timeframe or paginate before claiming complete totals.');
}
JS
```

`$metadata.service` and `event` are verified keys for this Worker. Before adding
other filters, inspect `result.events.fields` or use the documented telemetry
keys endpoint; do not guess nested field names. For errors, inspect the `err`
field deliberately and sanitize it before sharing. Do not dump raw event
envelopes, headers, cookies, IP addresses, or user identifiers into chat or git.

The API allows at most 2,000 events per page. For larger windows, pass the last
event's `$metadata.id` as `offset` with `offsetDirection: 'next'`, keep the same
timeframe/filters, and stop when a page is empty. Treat a repeated cursor or
incomplete query as an incomplete result, not an empty healthy window. State
the inspected timeframe and any retention/sampling limitations in the report.

Interpret the signals together:

- A scheduled invocation with platform `outcome: 'ok'` can contain caught
  `ingest.error` records. Count feed errors and anomalies separately.
- Reconcile D1 feed rows against `SOURCES` in `src/ingest/sources.ts`; retired
  endpoints remain in D1 and must not create active-feed overdue warnings.
- `failure_count` counts consecutive failures. The legacy `last_status` can
  retain an earlier successful response after a failed attempt.
- `MAX(items.fetched_at)` is the latest **insert**, not the latest poll. A
  publisher with no new articles can still be polled successfully.

