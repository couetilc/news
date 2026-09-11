# Production, UI, and testing review — September 10, 2026

Observed against production commit `264b58bbbee6aaf63dc03cfd00cc00f91b4072fc`, with browser testing of the 3px source-mark change on top. Audit window: September 10 evening, America/Chicago (September 11 UTC). Follow-up work lives in the linked GitHub issues; this document records the evidence and assessment.

## Browser access and visual change

The Codex in-app browser loaded and displayed both https://news.cuteteal.com and a locally built workerd preview at http://127.0.0.1:4332. Inspected actual screenshots and accessibility/DOM state at 1280x720 and 390x844, navigated to the live Status page, signed into the **local test account**, selected a source, and exercised a read toggle. Production was inspected anonymously; authenticated observations use local test state and 42 public article fixtures (two recent items per populated source), not the owner's production session.

Changed `.mark-hollow` from a 2px to a 3px border. The outer box remains 10x10px and its empty center shrinks from 6x6px to 4x4px (56% less white area). Browser measurements confirmed 3px/4px/10px, including inverted active source chips. The existing geometry regression failed on the old CSS and passed on the new CSS. Other mark fills retain their current styling.

## Production ingestion: running, with three sustained failures

D1 snapshot at approximately 02:34 UTC: **32 active feed URLs; 29 with zero consecutive failures, three failing**. There are 22 configured source identities, 21 with stored articles. One additional D1 row is a retired Cisco SEC endpoint; exclude it when evaluating overdue active feeds. No active next-poll timestamp was more than a cron interval overdue at the snapshot.

| Source | Consecutive failures | Latest production error | Independent Mac probe | Impact / follow-up |
|---|---:|---|---|---|
| Intel | 11 | Malformed XML on September 11, 00:15 UTC | HTTP 200 HTML, title “Intel Newsroom \| News and Information,” rather than RSS | Last inserted article August 26; [#377](https://github.com/couetilc/news/issues/377) |
| Owenomics | 10 | HTTP 404 on September 10, 06:45 UTC | Same configured Sitecore URL returns 404 HTML | Last inserted article August 30; [#378](https://github.com/couetilc/news/issues/378) |
| DeepSeek | 35 | HTTP 503 at 05:00, 13:00, and 21:00 UTC September 10 | HTTP 200 XML and three parsed items | No successful poll/items recorded in production; investigate the execution-environment difference, [#379](https://github.com/couetilc/news/issues/379) |

The separately configured Hugging Face “Open Models” backstop is polling successfully. Meta AI imported ten posts at 02:30 UTC, including Muse Voice Transcribe; its next scheduled poll is 08:30 UTC (six-hour interval).

Historical Workers Logs were available with the current credentials through Cloudflare's [telemetry query API](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/), using an ad-hoc query with `dry: true`. The 24-hour window ending 02:38 UTC returned 351 events, below the requested 2,000-event limit:

- 166 successful feed polls: 89 HTTP 200 and 77 HTTP 304.
- Five `ingest.error` events, all from the three sources above.
- No `ingest.anomaly` events in that returned window.
- 91 recorded scheduled invocations, all with platform outcome `ok`. Feed failures are caught inside an otherwise successful invocation, so `ok` is not proof all feeds worked.
- Recorded scheduling gaps included two approximately 30-minute gaps and one approximately 60-minute gap (17:15–18:15 UTC September 10). This is a log observation, not proof of a missed scheduler invocation or its cause. A durable heartbeat/last-attempt record would resolve that uncertainty.

**Visibility gap:** `failure_count` is consecutive failures, not historical total failures. The failure patch deliberately retains an older `last_status`; Intel's 304 and Owenomics' 200 therefore look reassuring if that column is read alone. Parse anomalies also do not count as failed polls. `/status` currently shows build metadata and a dashboard link, not ingestion health. DeepSeek is invisible in source chips because the chips derive from stored articles. Track active-feed freshness/error/anomaly state and a cron heartbeat in [#383](https://github.com/couetilc/news/issues/383).

**Reliability risk:** polling is sequential; fetch and body reading have neither a timeout nor a size cap. A stalled source can hold up the rest of that invocation. This was found in code and was not established as the cause of the observed gaps. Add bounded requests with hermetic stalled-body/following-feed tests: [#385](https://github.com/couetilc/news/issues/385).

## UI/UX assessment

The newspaper layout is coherent: restrained color, a readable 672px desktop column, strong headline typography, and source/date metadata that is easy to scan. The source marks help distinguish publishers without taking over the page. Mobile masthead controls do not overlap the title, and the inspected 390px layouts do not overflow horizontally. Source filters preserve URL state, and anonymous visitors can read the public feed without signing in.

The highest-value improvements are functional and spatial:

1. **Fix Recently viewed interactions.** In the local browser, filtering to OpenAI showed Unread 2 / Read 0 while an unrelated Cloudflare item remained in the global Recently viewed lane. Marking that lane item unread changed the filtered tally to 3 while the main list still held two items. It also left an empty Recently viewed heading. Reload restored the correct count and removed the heading. `submitReadForm()` retallies unconditionally, although lane items need not belong to the active filter. Cover matching-source reappearance, nonmatching-source counts, pagination, and empty-lane cleanup in [#381](https://github.com/couetilc/news/issues/381).
2. **Reduce the mobile preamble.** With all 21 populated sources at 390px, the filter panel alone is about 261px high. With one recent item, the primary feed begins around 705px down the screen; three recent items would push it farther down. A compact source picker with selected-source summary and a collapsible history section would expose more actual news while retaining the same visual style.
3. **Enlarge the read control's hit area.** The actual button measures 16x16px. Keep the drawn square small but give it a more comfortable, non-overlapping touch target. Combine this with the mobile layout work in [#382](https://github.com/couetilc/news/issues/382).

Pinned references are useful, but the user-facing “Scrape-protected” badge is implementation terminology; wording such as “Visit site” would more directly describe the available action. Treat this as optional copy polish, not a release blocker. The masthead's date-only visual link to Status is subtle; its accessible name correctly explains the destination, but feed-health information should be easier to discover when failures occur.

## Testing assessment

**Keep the layered approach; repair the boundaries and simplify its bookkeeping.** The suite is not too slow or too large for this application. Its strongest tests check real behavior: workerd/D1 semantics, parser fixtures and malformed inputs, pagination properties, auth navigation/cookies, and read-toggle scrolling. Unit tests cannot establish that a third-party source still serves the same format; production monitoring and small explicit live probes complement hermetic fixtures.

Measured evidence:

| Layer | Current result / cost | Assessment |
|---|---|---|
| Vitest node + workerd, Istanbul | 775 tests in 57 files; approximately 5 seconds locally; 100% statements, branches, functions, lines with `TZ=UTC` | Appropriate fast gate. Plain `npm test` fails the TI timezone case locally: 774 pass, one fails. |
| Playwright built-worker Chromium | 22 tests passed, approximately 1.1 minutes locally; previous CI run took 2m40s including setup | Valuable integration coverage. Existing browser regression was updated for the stroke; no extra ornamental unit test was added. |
| Stryker, pure modules | Latest completed CI run: 91.77%; 1,056 killed, four timeout, 95 survived, 300 ignored; zero NoCoverage; approximately 2m20s including setup | Useful advisory feedback. Surviving mutants are candidates for inspection, not automatically defects or a reason to chase 100% mutation score. |
| Property/fuzz tests | Included in the normal node suite with reproducible seeds | Useful for untrusted parser inputs and state/math invariants. No separate fuzz workflow is currently present. |

Concrete configuration and correctness findings:

- **Required browser gate is missing.** The live `protect-main` ruleset (`17521842`) requires only `test`, not the actual `e2e` check. The workflow fails honestly, but that does not block merges. Reopened [#279](https://github.com/couetilc/news/issues/279) with current API evidence. Its existing scope assigns the required-check configuration to the owner/admin. No ruleset or workflow changes were made during this audit. For the stroke PR, explicitly wait for both checks before merging.
- **Browser test isolation is unsafe.** Tests share normal `.wrangler/state/v3/d1` with development and can reuse an existing port-4321 server. Several cases delete all users/items. `resetUsers()` omits `item_reads`; there is no cascade and IDs are reused, so a new test signup inherited old read history. Use a dedicated test persistence directory and owned server, and reset related state consistently. [#380](https://github.com/couetilc/news/issues/380). The audit used an owned port/build for its browser suite, but the current helper still shared the local test database; production data was not reset.
- **Timezone dependence is a real parser bug.** TI's date-only string uses host-local Date.parse semantics, conflicting with the UTC contract. The local failure is reproducible; `TZ=UTC` is a validation workaround, not a fix. [#375](https://github.com/couetilc/news/issues/375).
- **Mutation execution errors can appear green.** The workflow uses `npm run test:mutation || true` and exits successfully when no report exists. Keep the score advisory but report harness crashes/missing reports as a failed advisory job. [#384](https://github.com/couetilc/news/issues/384), human-gated workflow change.

The 100% coverage floor is the owner's standing policy and was preserved. It gives useful missing-path pressure, but the live UI bug and stale production sources demonstrate its limits. Prefer tests tied to an observable contract; do not add tests merely to recite CSS, mocks, or implementation branches. The geometry assertion here earns its place by pinning the exact visual behavior requested.

Maintenance could be lighter: the node include list and worker exclusion list mirror dozens of paths, and adding a pure module also updates Stryker scope/configuration/mapping. A single runtime classification convention or shared manifest would reduce drift; avoid adding another guard framework to maintain those lists. Comments in several config files still describe old advisory/runtime placement and should be updated when that configuration is next changed. Scheduled mutation/E2E workflows already skip unchanged inputs; retain that cost control. There is no evidence justifying removal of the core test layers or adding another testing framework.

## Reproducing the key checks

- `npx wrangler d1 execute NEWS_DB --remote --command "SELECT source,feed,last_status,failure_count,next_poll_at FROM feeds ORDER BY source" --json` — read-only; reconcile against `SOURCES`, not all historical rows.
- Query the `news` service through the telemetry endpoint above, a bounded millisecond timeframe, `view: "events"`, `dry: true`, and `limit: 2000`. Summarize `ingest.poll`, `ingest.error`, and `ingest.anomaly`; exclude visitor metadata from shared evidence.
- `gh api repos/couetilc/news/rulesets/17521842` — compare required contexts with actual check names.
- `npm test` reproduces the non-UTC TI failure; `TZ=UTC npm test` verifies the remaining suite and coverage until #375 is fixed.
- `npm run test:e2e -- --config .playwright/meta-ai.config.ts` — ignored local override starts the current built worker on owned port 4331 with reuse disabled. This works around the port/build collision only; #380 is needed for proper persistent-state isolation.
- Latest inspected pre-change mutation run: https://github.com/couetilc/news/actions/runs/34554059566 . Latest inspected pre-change E2E run: https://github.com/couetilc/news/actions/runs/34554059537 .

No credentials, visitor metadata, raw production logs, or screenshots are committed. Before/after screenshots are attached to the visual change PR through the existing public R2 screenshot workflow.
