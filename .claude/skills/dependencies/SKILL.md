---
name: Dependencies
description: The project's dependency policy — a middle path between zero-dependency dogma and adding packages freely, plus the mechanism by which an async implementer agent proposes a new npm dependency for human approval instead of rolling its own or adding it unilaterally. Covers runtime vs dev/test/tooling tiers, selection criteria, and the propose→approve→resume flow.
when_to_use: Deciding whether to add an npm dependency; an implementer agent finds a vetted library would materially improve a solution (especially security/correctness — "don't roll your own crypto") or test quality; reviewing a dependency-proposal issue; choosing between rolling our own and pulling a package; anything touching package.json / package-lock.json.
---

# Dependencies

The default here is lean, but **not zero-dependency dogma.** This skill is the
middle path: when a vetted library genuinely beats a bespoke implementation —
above all for **security and correctness** ("don't roll your own crypto") — we
take the library, through a human-gated proposal flow. It mirrors the
container-tool policy ("Rule of two → raise an issue; image changes are
human-gated") in the global `CLAUDE.md`, extended to npm packages.

## The middle path

- **Default to zero-dependency for the trivial.** If a few clear lines cover it,
  write the lines — don't pull a package (and a transitive tree) for a one-liner.
- **Prefer a vetted library for the critical-or-complex.** Security/correctness-
  critical or genuinely intricate functionality (crypto/KDF, parsing untrusted
  input at scale, protocol clients) is exactly where a rolled-our-own version is
  a liability. A reputable, audited, maintained library is the safer choice: for
  password hashing, chained PBKDF2 is "rolling our own"; a vetted KDF lib is
  preferred.
- **Never add a dependency unilaterally, and never roll your own as a silent
  workaround to avoid the conversation.** Surface it (below).

## Two tiers, two bars

Judge a dependency by where it runs, because the costs differ:

- **Runtime dependencies** — shipped inside the Worker. **High bar.** Must clear:
  a real security/correctness or capability benefit; **audited / reputable /
  maintained**; **works in workerd** (no Node-only built-ins unless `nodejs_compat`
  covers them) *and* in both vitest pools; **bundle size** acceptable for an edge
  Worker; complements (doesn't fight) the hermetic no-network test rule. A KDF
  library is a runtime dep.
- **Dev / test / tooling dependencies** — `devDependencies`, never shipped to
  production. **Different bar:** the payoff is **maintainability / reuse / test
  quality**, not product security, and Worker bundle size is irrelevant. They
  *must* still work in the relevant vitest pool(s) and preserve the **hermetic,
  no-network** rule. `msw` (mocking outbound HTTP in tests, vs. the current
  `fetchFn` injection) is a dev/test dep.
- **Prefer a reputable dev-only dep over an undocumented config workaround —
  leanness shouldn't buy a fragile hack.** When the alternative to a small,
  vetted dev dep is a brittle config trick (e.g. a fake/empty tsconfig to dodge a
  missing peer), take the dep: Stryker needed `typescript` present, so adding it
  beat hand-faking a config the tool would silently misread.

**Agents are encouraged to propose *either* kind when warranted.** The human gate
(below) is the cheap backstop: a too-eager proposal costs one "no"; a *missed*
one costs brittle tests or rolled-our-own crypto. If the runtime-flavored
criteria make you hesitate to surface a test-tooling dep, don't — propose it and
let the human decide.

## The mechanism: pause → propose → approve → resume

When an implementer agent (in-session or async) judges a dependency would
materially improve its solution:

1. **Recognize** the dependency would help — especially security/correctness, or
   test quality that the zero-dep seam makes brittle.
2. **Pause** the dependent work. Do **not** add the dep unilaterally, and do
   **not** roll your own as a workaround to dodge the gate. If you can deliver a
   reasonable no-dependency version *and* it's not the security/crypto case, you
   may ship that as a labelled **fallback** while still proposing the lib.
3. **Propose** it: file a `dependency-proposal` issue (contents below), linked to
   the blocked issue. Then stop and report — this is a human-gated hand-off, like
   a Dockerfile change.
4. **Human approves / rejects** — the gate.
5. **Resume on approval:** the dependency is added in its **own small PR**
   (`package.json` + `package-lock.json` only), **human-merged** (the
   supply-chain step lands under human hands, like the image gate); *then* the
   blocked work resumes, building on the now-available dependency.

### The `dependency-proposal` issue should state

- **Package + version**, and **tier** (runtime vs dev/test/tooling).
- **Purpose** and **where it'll be used** (which modules/tests).
- **Alternatives considered**, including the no-dependency option and why it falls
  short (for crypto, why rolling our own is the wrong call).
- **Selection-criteria check** for its tier (audited/maintained; workerd + vitest
  pool compatibility; bundle-size impact for runtime deps; hermetic-rule fit).
- **Security note** — **required** for any dependency that touches crypto or
  parses untrusted input: provenance, audit/maintenance status, and the
  blast-radius if it were compromised.
- Lockfile/transitive-tree impact.

Label it `dependency-proposal` (+ the relevant area label, e.g. `auth`,
`testing`, `ingest`), and link the issue it unblocks.

## Defaults (adjustable by the human)

- **Dependency-add PRs are human-merged**, not auto-merged — the supply-chain
  step is the gate, mirroring `docker/**` and the launcher scripts.
- **Crypto/untrusted-parsing deps require the security note** above; other deps
  don't.

## Cross-references

- Global `CLAUDE.md` "Missing a tool?" — the analogous policy for *system* tools
  (apt/Dockerfile): ephemeral-first, rule-of-two, image changes human-gated.
- `issue-orchestration` skill — implementer agents dispatched against the backlog
  follow this flow; the orchestrator routes a paused proposal to the human rather
  than letting an agent add a dep.
- Project `CLAUDE.md` — the one-line pointer to this skill lives next to "npm for
  dependencies".
