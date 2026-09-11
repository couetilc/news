---
name: dependencies
description: Evaluate runtime and development dependencies for workerd compatibility, maintenance, security, and their value over existing code.
---

# Dependency decisions

Use [CLAUDE.md Authorization](../../../CLAUDE.md#authorization). Include an
in-scope dependency and its usage in the same reviewable feature PR. A package
change alone does not require a separate issue, package-only PR, or human merge.
Ask about an unapproved material dependency/trust or architectural change after
preparing its rationale and diff, before exercising the new consequence.

## Selection

- A few clear lines need no package; existing dependencies and platform APIs
  may already solve the problem. Prefer maintained libraries for intricate
  protocols, untrusted formats or security-sensitive functionality. Do not
  invent cryptography or use bespoke code to avoid evaluating a needed library.
- Runtime packages must work in workerd and the relevant tests. Check actual
  built-ins, bundle/startup impact, licensing, provenance, maintenance and
  transitive dependencies. `nodejs_compat` is not blanket Node compatibility.
- Dev/test packages need a concrete maintainability or verification benefit
  and compatibility with their test runtime. They can execute install/build
  code with host credentials; dev-only is not a security exemption.
- Keep unit tests hermetic. Live clients need an injectable transport or
  fixtures; a dependency must not make `npm test` require the network.

State the package/version, purpose, alternatives, compatibility evidence and
lockfile/transitive impact in the PR. For crypto or untrusted-input parsing,
explain the provenance and security implications. Use npm and commit the
lockfile; validate the behavior that uses the package. Avoid blind audit fixes
or unrelated upgrade campaigns.
