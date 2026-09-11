# Issue 401 verification

This work keeps Astro SSR, one Worker, D1 and KV. No service or access-policy
change is required. Migrations 0009 and 0010 are additive and precede deployment.

- URL safety: shared absolute HTTP(S) validation before insertion and at headline
  rendering. Invalid records are excluded with existing anomaly health and a
  quarantine count in poll logs. Mixed valid/invalid batches and legacy malicious
  links are exercised in workerd/component/Chromium tests.
- Session refresh: hourly KV renewal, coordinated by a D1 claim keyed by a
  SHA-256 session-ID hash. Claims have a one-minute retry cooldown and one-day
  retention. Ordinary activity does not claim or write. Tests use Astro's real
  session runtime plus real D1 and Chromium for concurrent requests, storage
  failure/retry, near-expiry renewal, cookie persistence and logout.
- Types: `npm run typecheck` runs the official MIT-licensed `@astrojs/check`
  0.9.10, a Worker-core check and a browser check. Astro imports browser DOM
  declarations internally, so its entry points/templates use the framework
  project. Core Worker code uses Wrangler runtime-only declarations generated
  under `.astro/`; browser code and happy-dom tests use DOM declarations without
  the HTMLRewriter Element collision. No authored source is omitted from all
  checks. Node/component tests and e2e TypeScript are checked too.
- Pagination: timestamp/id keysets with a 51st-row lookahead for 50 rendered
  articles. Cursors are length-, shape-, date- and integer-bounded; malformed
  cursors and retired offset URLs return 400. Local mutations retain the boundary
  and invalidate in-flight fragments; appended rows are deduplicated. This is a
  traversal, not a live snapshot: new rows ahead of the cursor appear on reload.

Run `python3 experiments/401/query-plan.py` for the before/after SQLite plans.
The new expression index allows an effective-time range seek and avoids a
sort for all-sources traversal. A filtered query can still use the source index
and sort its smaller subset; no extra source/time index was added. Real D1 tests
check the SQL semantics, ties, undated/fractional dates and both partitions.

After `npm run typecheck`, run `node experiments/401/typecheck-probes.mjs` for
negative controls in Worker, browser, Astro-template and Node-test code. Run this
alone: it temporarily adds deliberate type errors and removes them in `finally`.
The captured outputs alongside this file contain no production data.

Dependency maintenance updates Wrangler to 4.131.1, Vitest/coverage to 4.1.11 and
the Worker test pool to compatible 0.16.20, plus compatible lockfile fixes.
`@astrojs/check` adds official Astro language tooling for template diagnostics;
plain tsc cannot check Astro templates. It is development-only.

The resulting audit reports 7 affected entries (5 high, 2 moderate), not 7
independent production exploits. The Worker test pool pins older
Wrangler/Miniflare/undici/sharp; Stryker's typed-rest-client pins qs 6.15.1.
These are development/tooling paths, not the deployed Worker request handlers.
Ingestion uses native workerd fetch; the app serves no uploaded image optimizer
and uses compile-time images. This reduces demonstrated production reachability,
not host/tooling risk. No forced test-pool major/pre-1 minor migration or override
of upstream exact pins was made just to clear the audit count.
