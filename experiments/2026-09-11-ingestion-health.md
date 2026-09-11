# Ingestion health and bounded polling validation

The owner can reach live feed health from the digest. `/status` shows private
operational state only with an owner session; anonymous responses retain public
deployment metadata. Both response variants send `private, no-store`.

Migration `0008` adds current feed health and invocation identities. Attempts
are written before the upstream request; completions are separate. A newer
unfinished run stays visible when an older overlapping run finishes. The newest
192 run records are retained. Existing historical timestamps remain unknown
until a tracked poll supplies evidence.

A 304 resolves request errors but preserves a parsing concern until a fresh,
clean 200 response. The page separates interrupted attempts, request failures,
parser concerns, never-tracked sources, scheduling delays, and quiet publishers.
Retired endpoints do not create active-feed overdue warnings. Article timestamps
represent source-level insertion/publication freshness, not the latest poll.

## Reproduce

```sh
npm test
npm run test:e2e
npm run build
npm run test:mutation -- --mutate src/ingest/bounded-fetch.ts,src/lib/feed-health.ts --testFiles test/bounded-fetch.test.ts,test/feed-health.test.ts --concurrency 4 --timeoutMS 2000
node experiments/verify-bounded-feeds.mjs
```

The browser suite owns its build, D1/KV state, and unused loopback port. Its
`feed-health.spec.ts` fixture seeds current, failing, anomalous, never-tracked,
and retired feeds plus an overlapping incomplete invocation. The spec navigates
through the actual signed-in link, checks anonymous exclusion, then uses a fresh
`/status` document before screenshots to avoid capturing a view transition.

The pre-change browser regression failed at the missing **Feed health** link.
The implementation passes the owner state/cache/privacy assertions and all 28
browser cases, including existing mobile navigation and read-toggle regressions.
The production build passes. The final unit run passes 865 tests in 66 files,
with 100% statements, branches, functions, and lines.

The targeted mutation run detected 232 of 235 tested mutants: 229 assertion
kills and three runner timeouts (98.72%). `bounded-fetch.ts` detected all 39;
removing deadline/race/stream termination cannot hang the runner beyond its
finite guard, and the complete run finished in nine seconds. Three surviving
health mutants are equivalent for positive stored timestamps (removing null
checks before numeric comparison) or preserve the first-priority sort order
(replacing the first priority entry with an absent key still sorts it first).
None were hidden with mutation exclusions. Mutation feedback strengthened
custom transport headers/cleanup, mixed active/retired classification, attention
counts, visible explanations, same-second completion, and timestamp assertions.

## Upstream limits and live read-only probe

One 20-second deadline covers headers, streaming, and a custom loader's complete
upstream phase. Each body is limited to 8,388,608 decoded bytes, including every
intermediate JSON body and the synthetic final response. This bounds actual
streamed bytes, preserves split UTF-8, and does not trust Content-Length.
Cancellation is requested without awaiting a stuck cancel operation. The
following feed is still attempted after a timeout or oversize failure. The timer
does not interrupt synchronous parser execution or D1 operations; the separate
heartbeat makes an invocation without completion visible.

Read-only probe at **2026-09-11 13:55:24 UTC**, using the real bounded transport:

| Source | HTTP | Decoded result bytes | Parsed items | Elapsed ms |
| --- | ---: | ---: | ---: | ---: |
| OpenAI | 200 | 723,198 | 1,189 | 546 |
| Intel | 200 | 549,825 | 184 | 356 |
| Open Models | 200 | 254,164 | 861 | 294 |
| DeepSeek | 200 | 50,934 | 21 | 549 |
| Owenomics | 200 | 2,817 | 20 | 1,384 |

Owenomics's row measures the normalized result; its two upstream JSON responses
also use the bounded transport. A dedicated hermetic regression rejects an
oversized second response before the loader can consume it. These observations
support generous growth headroom; they do not predict future publisher latency
or body size. The live probe is separate from the hermetic unit/browser suites.

## Browser screenshots

Before is the previous production status page, which exposed deployment data.
After is the real local workerd application with synthetic owner health records;
no production account or read-state mutation was used. Phone: 390×844 viewport.
Desktop: 1280×900 viewport. After captures include the full page.

| View | Before | After |
| --- | --- | --- |
| Phone | [Before](https://news-cdn.cuteteal.com/pr-screenshots/383/before-phone-c1ab14b3.png) | [After](https://news-cdn.cuteteal.com/pr-screenshots/383/after-phone-8301560b.png) |
| Desktop | [Before](https://news-cdn.cuteteal.com/pr-screenshots/383/before-desktop-3b9ed60a.png) | [After](https://news-cdn.cuteteal.com/pr-screenshots/383/after-desktop-08a3630d.png) |
