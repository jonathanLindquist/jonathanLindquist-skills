---
name: to-spec-jl
description: >-
  Jonathan Lindquist's manually invoked spec-authoring workflow. Use only when
  the user explicitly invokes $to-spec-jl to synthesize the current
  conversation and verified repository context into a standalone, epic-level
  implementation spec or PRD under docs/spec or an established docs/prd
  directory. Does not create or modify issue-tracker tickets; use $to-tickets
  separately for ticket breakdown and publication.
metadata:
  deprecated: "false"
disable-model-invocation: true
---

# To Spec JL

Turn the current conversation and repository context into a durable,
implementation-ready epic spec. Write the spec into the repository. Keep the
spec and the issue tracker as separate concepts.

Do not start an intake interview. Synthesize what is already known, make
reasonable assumptions, and record unresolved material questions in the spec.
If the user supplied a document, issue, or other source, retrieve and read the
full current source before writing.

## Artifact contract

- Create or update one standalone Markdown spec in `docs/spec/` or `docs/prd/`.
- Do not create an issue, Kanban card, tracker ticket, or ticket-linked
  `docs/plans/` file for the spec.
- Do not allocate a ticket ID or prefix the spec filename with a ticket ID.
- Do not run `new_project_ticket.mjs`, edit the issue-tracker board, or invoke
  `$to-tickets` as part of this skill.
- Leave ticket decomposition to a later, explicit `$to-tickets <spec-path>`
  invocation. That skill owns bite-sized vertical slices, blocking edges, and
  tracker publication.

## Workflow

### 1. Gather the source material

Use the current conversation as the primary statement of intent. Read any
referenced plans, prototypes, documents, issues, or prior specs in full. Treat
an existing tracker item as input only; do not turn the spec into that item or
modify tracker state.

### 2. Verify the repository context

Inspect the current repository before describing its implementation:

- Follow `AGENTS.md` and any more-local instructions.
- Read `CONTEXT.md`, the applicable `docs/adr/` records, and the project's
  domain glossary when they exist.
- Read `docs/agents/` when present to understand project conventions, while
  keeping the spec outside the ticket workflow.
- Inspect the relevant production and test code so current-state claims,
  module boundaries, contracts, and test seams are evidence-based.
- Prefer the project's established domain language throughout the spec.

### 3. Choose the spec path

Use a user-supplied path when it is under `docs/spec/` or `docs/prd/`.
Otherwise:

1. Follow a documented repository convention between `docs/spec/` and
   `docs/prd/`.
2. If only one of those directories already exists, use it.
3. If both exist and the convention is ambiguous, use `docs/spec/`.
4. If neither exists, create `docs/spec/`.

Use a descriptive kebab-case filename without a tracker ID, for example
`docs/spec/account-recovery.md`. Update a clearly matching existing spec when
the user asks for a revision; do not overwrite an unrelated document.

### 4. Define the epic boundary

Describe one coherent product or system outcome large enough to require
multiple implementation tickets. Capture the complete intended end state,
cross-cutting constraints, affected capabilities, and delivery risks.

Do not pre-write the issue backlog. The implementation strategy may describe
capability-level sequencing, migration order, or dependency constraints, but
it must not become a numbered list of ticket-sized tasks.

### 5. Identify implementation and testing seams

Describe the architecture at stable module and interface boundaries. Include
repo-relative file paths only when they clarify verified current state or a
durable integration point; never write machine-local absolute paths.

Identify the highest meaningful existing test seam for each major behavior.
Prefer observable behavior over implementation-detail assertions. Record new
seams only where the current design cannot verify the required behavior.

### 6. Write the spec

Use the template below. Keep every major section; when a section genuinely does
not apply, say why instead of silently omitting it. Be specific enough that
`$to-tickets` can later derive small vertical slices without rediscovering the
product and architecture decisions.

<spec-template>

# <Epic title>

## Summary

Summarize the user-visible outcome, the reason to build it, and the proposed
approach.

## Problem Statement

Describe the current problem from the user's perspective, who experiences it,
and the cost or limitation of the current state.

## Goals and Success Measures

List the outcomes this epic must achieve and the observable or measurable
signals that show it succeeded.

## Non-Goals

State adjacent work and tempting extensions that are intentionally excluded.

## Stakeholders and Actors

Identify the people, systems, and operational roles that interact with or are
affected by the result.

## User Stories

Provide a numbered set of meaningful epic-level stories in this form:

1. As a <actor>, I want <capability>, so that <benefit>.

Cover primary, administrative, operational, and failure-recovery needs without
inflating minor UI details into separate stories.

## Current State

Describe the verified relevant behavior, architecture, constraints, existing
contracts, and test coverage. Distinguish repository evidence from assumptions.

## Proposed Solution

Describe the intended end-to-end experience and system behavior, including the
happy path and the most important alternate or failure paths.

## Functional Requirements

Give each requirement a stable identifier such as `FR-1`. State externally
observable behavior and invariants, not ticket-sized implementation steps.

## Non-Functional Requirements

Cover applicable performance, reliability, availability, accessibility,
compatibility, maintainability, security, privacy, and compliance constraints.

## User and System Flows

Describe the main flow plus validation, authorization, empty-state, retry,
partial-failure, cancellation, and recovery behavior where applicable.

## Technical Design

### Boundaries and Responsibilities

Define the modules or services involved and the responsibility owned by each.

### Interfaces and Contracts

Define API, event, command, UI, or internal module contracts, including
validation and compatibility expectations.

### Data Model and Lifecycle

Define relevant entities, state transitions, persistence, ownership,
retention, migration, and consistency rules.

### Dependencies and Integrations

Identify internal dependencies, external systems, feature gates, and ordering
constraints.

### Security and Privacy

Describe trust boundaries, authentication, authorization, sensitive data, and
abuse or misuse considerations.

### Observability and Operations

Define logs, metrics, traces, auditability, support diagnostics, alerts, and
operational ownership needed for the feature.

## Implementation Strategy

Describe capability-level sequencing, compatibility approach, migration shape,
and integration order. Keep this at epic level; do not draft tickets or assign
tracker IDs.

## Testing Strategy

Name the preferred behavior-level seams, the important scenarios at each seam,
existing prior art, required fixtures or environments, and any manual or
non-functional validation.

## Rollout, Migration, and Rollback

Describe safe release stages, data or configuration migration, feature flags,
backward compatibility, end-of-phase proof, rollback triggers, and recovery.

## Risks and Mitigations

List product, technical, operational, delivery, and dependency risks with a
concrete mitigation or decision path for each.

## Epic Acceptance Criteria

List observable end-state criteria for the whole epic. These are the source
for later ticket acceptance criteria, not a replacement for them.

## Assumptions

Record decisions inferred from incomplete context and the evidence supporting
them.

## Open Questions

Record only unresolved decisions that materially affect scope, architecture,
or delivery. Include the decision owner or resolution path when known.

## References

Link relevant repo documents, ADRs, prototypes, external sources, or existing
tracker items used as input. Use repo-relative paths for repository files.

</spec-template>

### 7. Verify and hand off

Before finishing:

- Confirm the artifact is under the selected spec directory and contains no
  machine-local absolute paths.
- Check that current-state claims match the repository and that known product,
  architecture, testing, rollout, and risk decisions are represented.
- Check that the document describes an epic rather than a ticket backlog.
- Confirm no issue-tracker state, ticket sequence, Kanban board, or
  `docs/plans/` file changed as a side effect.
- Report the spec path and the most important assumptions or open questions.
- Mention `$to-tickets <spec-path>` as the separate next step when the user is
  ready for ticket decomposition; do not invoke it automatically.
