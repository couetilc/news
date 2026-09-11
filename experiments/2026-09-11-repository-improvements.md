# Repository improvements — September 11, 2026

This is the completion record for the production, interface and testing review.
GitHub issues remain the backlog of record; the remaining work is evaluated in
the [backlog proposal](2026-09-11-backlog-proposal.md).

## Delivered changes

- Meta AI is an active source, including Muse Voice Transcribe. The source marks
  use a 3px stroke with a smaller 4px center. These preceded the follow-up fixes.
- [PR #389](https://github.com/couetilc/news/pull/389) makes mobile filters and
  reading history collapsible, enlarges read-button targets to 44px, and fixes
  Recently viewed counts, ordering, pagination, empty states and asynchronous
  toggle behavior. With identical fixtures, the first story moves from y=894
  to y=431 on a phone while the desktop reading column stays 672px wide.
- [PR #390](https://github.com/couetilc/news/pull/390) replaces broken Intel,
  Owenomics and DeepSeek transports with current first-party sources. Its
  targeted migration repairs 34 Intel links while preserving item identities
  and read history. The [production acceptance report](2026-09-11-production-acceptance.md)
  records the successful natural scheduled polls and their limits.
- [PR #388](https://github.com/couetilc/news/pull/388) documents the verified
  historical Workers Logs query path, including its actual permission scope.
- [PR #391](https://github.com/couetilc/news/pull/391) fixes host-dependent TI
  dates, isolates browser-test storage and build output, resets per-case state,
  removes duplicated runtime classifications, and makes mutation-runner/report
  failures visible while retaining advisory mutation scores.
- [PR #392](https://github.com/couetilc/news/pull/392) adds owner-only feed health,
  separate scheduled-run start/completion records, retained error and parser
  recovery information, and a 20-second/8-MiB upstream boundary. Quiet publishers
  and retired endpoints are distinguished from active failures. See the
  [health validation report](2026-09-11-ingestion-health.md).
- The `protect-main` ruleset now requires both `test` and `e2e`. A live PR was
  verified blocked while its browser check was pending; #279 is closed.

## Testing assessment and evidence

Keep the two Vitest projects: real D1/workerd behavior needs the Worker runtime,
while parsers and other pure logic belong in Node. The 100% coverage policy is
retained. Coverage remains a floor; tests assert observable behavior and
regressions rather than merely execute lines.

The previous browser harness could reuse and mutate development state. Each
invocation now owns its port, D1/KV/R2 persistence, runtime variables, Astro
metadata, build output and reports. A simultaneous full suite plus signup suite
left all 68 existing development files unchanged, removed its temporary roots,
and preserved the existing dev-server processes. See the repeatable
[testing evidence](2026-09-11-testing-foundations.md).

Mutation testing remains useful as an advisory measure. Its score does not
block a PR, but a broken runner or invalid/missing report now produces an
honest failed check. The foundation's complete run scored 91.13%.

The final application passed 865 unit tests across 66 files at 100% coverage on
all four metrics, 28 isolated browser tests, and its production build. Targeted
health/deadline mutation testing detected 232 of 235 measured mutants (98.72%);
the bounded-fetch helper detected all 39. The three remaining health mutants
were reviewed as equivalent under the supported input domain and ordering.

The health release deployed as `57a5f5947875611fd04fe99256e60d578184a1aa` at
14:14 UTC. Its first natural tracked invocation started at 14:15:51 and finished
at 14:15:54, with one feed checked, no failures, no parsing anomalies and no
batch error. IEEE Spectrum recorded HTTP 200 and a clean successful check.
All 32 active feeds had zero failure streaks and none were overdue. At this
snapshot, one feed had new tracker history and 31 awaited their normal cadence;
unknown historical timestamps were not invented or treated as successful polls.
The [production health acceptance report](2026-09-11-health-production-acceptance.md)
includes migration and indexed-log corroboration.

Production `/status` and `/status/` were checked in HTTP responses and the
browser: both exposed the expected deployment, sent `private, no-store` with
`Vary: Cookie`, and excluded operational fields from anonymous responses.

## Verified working capabilities

- Browser access: inspected both the running local app and production, including
  visible UI and mobile/desktop screenshots. The existing development app at
  `http://127.0.0.1:4321/status` renders the new owner health page. Local migrations
  `0007` and `0008` were applied after backing up local D1 under the ignored
  `.wrangler/backups/2026-09-11-before-health/` directory.
- GitHub: unsigned local commits, ordinary branch pushes, PR creation, required
  checks and merges work. The existing CLI login lacks the `workflow` scope;
  the connected GitHub integration successfully published the approved workflow
  changes. Its published Git tree exactly matched the locally tested tree.
  No additional login authorization was needed.
- Cloudflare: the normal merge-to-main CI deployment works. Local tooling can
  read production D1 and historical telemetry and upload review screenshots to
  the configured R2 bucket. Credentials were kept out of reports and commits.

No dependencies were added. A separate [README proposal (#394)](https://github.com/couetilc/news/issues/394)
contains the exact draft for review under the repository's README policy. The
remaining six issues and two older PRs each have a disposition in the backlog proposal.
