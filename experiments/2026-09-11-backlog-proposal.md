# Remaining backlog proposal

Prepared September 11, 2026. This is a review snapshot; GitHub issues remain the backlog of record. It is a proposal for the older outstanding work, not authorization to create accounts, grant credentials, add SSO, or provision staging.

Reviewed the full issue bodies and comments, plus the two open PR diffs and review state:

| Item | Proposed disposition |
| --- | --- |
| [PR #367](https://github.com/couetilc/news/pull/367) | Supersede with the corrected larger documentation PR. |
| [PR #371](https://github.com/couetilc/news/pull/371) | Rebase and correct the capability claims before merging. |
| [#366](https://github.com/couetilc/news/issues/366) | Close when the consolidated environment guidance lands. |
| [#368](https://github.com/couetilc/news/issues/368) | Preserve the useful findings in that guidance, then close the reference investigation. |
| [#370](https://github.com/couetilc/news/issues/370) | Implement genuinely isolated PR environments if remote previews are still wanted. |
| [#369](https://github.com/couetilc/news/issues/369) | Narrow the observability scope and verify credential availability first. |
| [#341](https://github.com/couetilc/news/issues/341) | Defer until there are specific additional users and an access policy. |
| [#394](https://github.com/couetilc/news/issues/394) | Review the exact README draft separately, then land the approved wording. |

## Recommended order

1. Consolidate the environment documentation through a corrected PR #371; supersede PR #367 and close #366 when the final guidance lands. Fold the useful constraints from #368 into that guidance, then close #368 as a reference investigation.
2. Build isolated, CI-owned PR previews under #370 if remote visual review is still useful after the new isolated local browser harness. A fixed shared staging Worker does not satisfy per-PR isolation.
3. Rework #369 around the actual minimal observability capability and current credential UI availability. Keep cloud sessions credential-free until that is verified; the existing local/CI deployment path and owner health UI work meanwhile.
4. Leave #341 as a product decision until there are specific additional users to onboard. Prefer the hybrid SSO entry path if passwordless access becomes a real need.

The small README follow-up [#394](https://github.com/couetilc/news/issues/394) can run alongside the environment-documentation work. It contains an exact draft for the new health capability, the two test runtimes, isolated browser checks and advisory mutation reporting. The repository's README policy requires Connor's sign-off before that separate README-only change lands; no implementation is waiting on it.

## Documentation: #366, #368, PR #367, PR #371

PR #371 contains PR #367's changes. Review and refresh the larger PR on current main rather than merge both independently. Preserve the implemented testing isolation and required `test`/`e2e` checks during the rebase.

Concrete corrections before merge:

- Distinguish the configured Full network setting from a verified live capability in a particular cloud session. The August account observation is not a current UI check.
- Replace the claim that Full egress is safe simply because there are no Cloudflare credentials; state the chosen credential boundary without a blanket safety claim.
- A successful CI deploy and an HTTP/browser smoke check establish different things. Keep both where the execution surface allows them.
- The proposed `print-feed-allowlist.mjs` scans URL strings in comments, includes unused fallback hosts, and misses URLs in the new Owenomics loader. Either drop this optional helper while Full mode is the intended setup, or explicitly cover actual multi-step transport origins and redirects.
- Update the credential-UI description against current Anthropic documentation, and verify availability in the actual account before claiming it works. Current docs describe proxy-injected credentials for Pro/Max, not Team/Enterprise. See [cloud environment documentation](https://code.claude.com/docs/en/cloud-environments).
- Keep #368's dated investigation as evidence. Transfer only the guidance still needed today; avoid treating every historical proxy observation or inferred wildcard behavior as a permanent contract.

Acceptance: one coherent skill/doc diff, no application change, current tests and browser checks passing, and the capability matrix explicitly distinguishes local, container, cloud, and CI evidence. Then close #367 as superseded and #366 as completed; close #368 after its remaining guidance is accounted for.

## PR previews: #370

The issue promises a URL per branch but proposes one `news-staging` Worker and one database. Per-branch CI concurrency does not prevent two branches from overwriting that same destination.

Recommended implementation: trusted same-repository PRs deploy `news-pr-<number>` with their own D1, SESSION KV, and any writable R2 resources. Build the Worker against that exact configuration, apply migrations, and seed public fixtures and test-only authentication. Exclude production routes, production binding IDs, production credentials, and scheduled scraping by default. Use an explicit staging-only ingestion smoke check for source work. A preview upload is a code version, not a copy of its data: [Worker versions capture bindings, while storage state is separate](https://developers.cloudflare.com/workers/versions-and-deployments/).

Keep deployment credentials in CI. Restrict the deploy workflow to trusted PR code, publish the URL on the PR, and remove only resources owned by that PR on close. Include an orphan-cleanup procedure and a resource-count limit. A supported [Workers environment creates a separate Worker](https://developers.cloudflare.com/workers/wrangler/environments/), but the name and writable resources must still vary per PR to meet this issue's promise. Prefer real isolated Workers for scraper diagnosis: current [preview URL limitations](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/) exclude logs.

Acceptance: two PRs run concurrently without sharing code, auth, or data; a test write changes neither production nor the other preview; migrations and browser smoke checks work; closing one PR removes only its resources. Decision for the owner: automatic previews on every trusted PR or on-demand previews; recommend on-demand initially to control resource churn.

## Cloud observability: #369

Re-scope this issue before creating a token. Its proposed read-only permission list does not cover every promised operation: Cloudflare documents **Workers Observability Write** for [historical telemetry queries](https://developers.cloudflare.com/api/resources/workers/subresources/observability/subresources/telemetry/methods/query/). The [D1 query API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) currently accepts D1 Read or Write, so verify the exact read-only path rather than assume SQL reads require Edit.

Start with feed status, cron heartbeat, and sanitized ingestion events. Raw SESSION KV, users, and read histories are unnecessary for that goal. Prefer the existing local tooling or a narrowly scoped diagnostic export/API over broadly exposing production storage. Never substitute the production deployment token or a session-readable environment variable for the hidden-credential requirement already recorded in #369.

Acceptance: the actual account exposes the supported credential UI; a fresh cloud session can perform the approved reads while write/deploy attempts are denied in a safe test scope; credentials and private account/session content never enter logs or reports. Any broader telemetry permission needs an explicit scope decision. If the UI remains unavailable, record that current blocker and retain the working local/CI path.

## Additional users and SSO: #341

The application already meets its stated single-user goal. Do not expand authentication merely to clear the issue. First identify the intended users, permitted identity providers, and who should have access to operational health.

If expansion is wanted, use the issue's hybrid `/sso` option while retaining the public feed and owner password fallback. Validate the Access JWT in the Worker itself, including signature, issuer, audience, and lifetime; a header's presence is insufficient, including on alternate Worker hostnames. Cloudflare's [JWT validation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) uses a maintained verifier and JWKS. Propose any new verification dependency through the repository's dependency process.

Acceptance: signed-in identity maps safely to an account, passwordless accounts reject password login safely, anonymous feed access survives, invalid/wrong-audience/expired/rotated-key tokens are covered, no production dev bypass exists, and operational access has an explicit owner boundary before more accounts are admitted. Local tests should inject verification inputs rather than add an authentication bypass to production code.
