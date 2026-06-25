---
name: implement-review-security
description: >-
  Default implementation workflow that finishes with review and a bundled
  security scan. Use when implementing a PRD, issue, ticket, card, feature, bug
  fix, or refactor where file changes should be tested, reviewed, and then
  checked with security-scan before closeout.
---

Implement the work described by the user using the normal implementation
discipline, then run a security scan before the final response.

If repo-local instructions conflict with this skill, follow the repo-local
instructions.

If the work comes from a PRD, issue, ticket, or card, read that source first.
The Obsidian Kanban referenced in the project docs, if present, is the ticketing
source of truth.

Before editing, identify the relevant test seam. Prefer /tdd where practical, at
pre-agreed or repo-established seams.

For behavior changes, add or update tests at the appropriate level for the repo:
unit, integration, end-to-end, or the closest existing equivalent. Behavior
changes include production code, user-visible output, APIs, schemas, bug fixes,
and behavior-affecting refactors.

Docs/config-only edits do not require test updates unless repo-local
instructions say they do, but still verify them appropriately.

Run focused checks regularly while working, such as typechecking and single test
files. Run the fullest practical test suite once at the end.

Once implementation checks pass, use /review to review the work when available
and proportionate to the change.

After review, invoke the /security-scan skill before closeout. Pass the changed
files, affected modules, new or changed entry points, and auth/data/schema
implications so security-scan can create or refresh `sast/architecture.md`.
Otherwise, read `$HOME/.agents/skills/security-scan/SKILL.md` and follow it from
the current repo root.

Treat confirmed security regressions as part of the implementation work when
they are caused by the current change and can be fixed within scope. Fix them,
rerun the relevant focused tests, and rerun the relevant security-scan checks.
If a finding is pre-existing, out of scope, or needs product input, report it
separately rather than hiding it.

Commit only when the work comes from a PRD, issue, ticket, or card, or when the
user explicitly asks for a commit. Otherwise leave changes uncommitted and
report the changed files, tests changed, checks run, review result, security
scan result, and any reason tests were not added.
