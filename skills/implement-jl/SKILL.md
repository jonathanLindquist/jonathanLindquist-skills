---
name: implement-jl
description: >-
  Jonathan Lindquist's default implementation workflow for file-changing work.
  Use when the user asks to use implement-jl, or when implementing a PRD,
  issue, ticket, card, feature, bug fix, refactor, or any user request likely
  to modify files with JL's engineering discipline. Identifies test seams, adds
  or updates tests for behavior changes, runs focused checks, and reports
  verification without performing a review pass.
---

Implement the work described by the user using normal engineering discipline.

If repo-local instructions conflict with this skill, follow the repo-local
instructions.

If the work comes from a PRD, issue, ticket, or card, read that source first.
The Obsidian Kanban referenced in the project docs, if present, is the ticketing
source of truth.

Before editing, identify the relevant test seam. Prefer /tdd where practical,
at pre-agreed or repo-established seams.

For behavior changes, add or update tests at the appropriate level for the repo:
unit, integration, end-to-end, or the closest existing equivalent. Behavior
changes include production code, user-visible output, APIs, schemas, bug fixes,
and behavior-affecting refactors.

Docs/config-only edits do not require test updates unless repo-local
instructions say they do, but still verify them appropriately.

Run focused checks regularly while working, such as typechecking and single test
files. Run the fullest practical test suite once at the end.

Commit only when the work comes from a PRD, issue, ticket, or card, or when the
user explicitly asks for a commit. Otherwise leave changes uncommitted and
report the changed files, tests changed, checks run, and any reason tests were
not added.
