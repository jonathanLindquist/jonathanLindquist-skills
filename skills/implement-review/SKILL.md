---
name: implement-review
description: >-
  Default implementation workflow that finishes with review. Use when
  implementing a PRD, issue, ticket, card, feature, bug fix, or refactor where
  file changes should be tested and reviewed before closeout.
---

Implement the work described by the user using the normal implementation
discipline, then review the change before the final response.

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

Commit only when the work comes from a PRD, issue, ticket, or card, or when the
user explicitly asks for a commit. Otherwise leave changes uncommitted and
report the changed files, tests changed, checks run, review result, and any
reason tests were not added.
