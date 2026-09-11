---
name: filing-issues
description: Record useful deferred work and maintain a small, reviewable GitHub backlog for this personal app.
---

# Issue conventions

GitHub issues are the backlog. Search open and closed issues before filing;
extend the matching issue instead of duplicating it. Fix small in-scope findings
on the current PR. Do not turn every observation into a follow-up issue.

An issue should explain the intended outcome, why it matters, bounded scope and
observable acceptance. Put decisions and source-selection checkboxes in its
body; preserve user edits and fold settled discussion back into that contract.
Close completed work from its PR with `Fixes #N`.

Use one type (`bug`, `enhancement`, `documentation`) and relevant area labels
from `gh label list`, such as `ingest`, `testing`, `ui`, `auth` or `agent-infra`.
Use cross-links for related work and native sub-issues only for an actual
parent/child task. Boards, milestones and elaborate label schemes are not the
default for this personal repository.

Approval and delivery are covered once in
[CLAUDE.md](../../../CLAUDE.md#authorization). State a real unresolved decision
when there is one; a file path alone does not make an issue human-gated.
