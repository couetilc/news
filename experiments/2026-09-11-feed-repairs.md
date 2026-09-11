# Production feed repairs — 2026-09-11

Repairs #377 (Intel), #378 (Owenomics), and #379 (DeepSeek). All source requests
were verified from a Cloudflare remote Worker preview using the production
parsers and loaders. The preview had no routes, cron, secrets, or storage
bindings and was stopped after verification. Production acceptance still needs
the first real scheduled poll after merging and deployment.

| Source | Replacement | Worker result | Deduplication and scope |
|---|---|---|---|
| Intel | Official AEM newsroom HTML | HTTP 200; 184 raw/parsed card occurrences; 3 unique fresh articles; no missing titles/dates | Keep the `intel` identity; fixed August 27, 2026 cutoff resumes after the last legacy RSS publication day and avoids archive flooding. Migration 0007 repairs all 34 existing URLs without changing IDs, guids, timestamps, or read history. |
| Owenomics | Public Sitecore Cloud search plus Acadian's canonical URL resolver | Both POSTs HTTP 200; 20 results resolve to 20 existing canonical article URLs; no missing titles/dates | Keep `owenomics`, canonical URL guids, and first-of-month UTC publication precision. No new essays are currently listed after August; a successful repair can insert zero items. |
| DeepSeek | Official API changelog | HTTP 200; 21 dated sections; 5 announcements after the fixed January 1, 2026 cutoff; no missing titles/dates | Stable dated-section guids, dedicated first-party article URLs when present, otherwise changelog anchors. The Hugging Face open-models source remains configured. |

The previous Intel RSS URL now redirects to an HTML newsroom. Acadian migrated
from Sitecore's old `GetArticlesByTopic` endpoint to a Next.js frontend backed
by public Sitecore Cloud search. Its browser sends a second same-origin request
to resolve search IDs to canonical article URLs. The loader reproduces those
read-only listing requests through injected `fetch`, passing the caller's
headers and cancellation signal to both. The client context and index IDs are
public frontend routing identifiers, with no private account credentials.

OpenRSS returned HTTP 503 from Workers with the explicit page title **Feed
temporarily unavailable** and a message asking users of verified readers to
contact the provider. The identical URL returned XML locally. This establishes
an execution-environment difference without establishing its cause. The new
first-party DeepSeek changelog works from Workers and contains actual releases,
including DeepSeek-V4.1-Flash on September 10; the previous proxy had mostly
surfaced changed guide pages.

## Intel identity migration

`intel-verified-url-mapping.json` records every exact old/new URL and match
method. Twenty-nine aliases have unchanged slugs, normalized matching
headlines, and equal UTC publication days in the migrated listing. Five were
verified against article canonical tags and a matching distinctive 20-word
excerpt from their persisted original RSS summaries. A few migrated pages have
a different displayed day, so the migration deliberately preserves the stored
original timestamps. It never guesses from a title alone.

The shipped SQL only updates an exact `(source, guid, old URL)` match. A
pre-existing new canonical URL causes that mapping to be skipped, preserving
both rows for explicit review rather than deleting data. The D1 regression
replays the actual migration over all 34 mappings, including read history,
repeat application, new parser guids, other sources, unknown guids, unmapped
rows, and canonical collisions.

## Reproduction

Local public-network probe:

```sh
node experiments/verify-feed-repairs.mjs
```

Cloudflare execution environment, without deploying the application:

```sh
npx wrangler dev --config experiments/feed-repairs-probe.jsonc \
  --env-file .env --remote --port 4395 --inspector-port 9395
curl -fsS 'http://127.0.0.1:4395/?source=intel'
curl -fsS 'http://127.0.0.1:4395/?source=owenomics'
curl -fsS 'http://127.0.0.1:4395/?source=deepseek'
# Stop Wrangler when done; do not deploy this diagnostic Worker.
```

Sanitized results from the actual remote preview are retained in
`feed-repairs-workers-evidence.json`. Tests use captured public card/search
fixtures and injected HTTP responses; they never fetch the network. Parser
fuzzing covers malformed card/section boundaries, invalid dates and links, and
unexpected document shapes. Unit tests verify raw counts, source cutoffs,
canonical URL resolution, inherited request headers/signals, failures in either
Owenomics request, and integration through real local D1.

Validation: `TZ=UTC npm test` passes 798 tests, with 100% statements, branches,
functions, and lines. UTC is the existing #375 TI-date workaround until the
parallel testing fix is integrated. The loader consumes both JSON bodies
through its injected request boundary; the pipeline timeout/body-size follow-up
must bound those intermediate responses as well as the final parser payload.
