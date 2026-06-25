# Issue Tracker: Obsidian Kanban

Issues, implementation tickets, and project task state for this repo live in an Obsidian Kanban board.

## Board

- Vault env var: `PROJECT_WORKFLOW_OBSIDIAN_VAULT`
- Board path strategy: derive from the vault root and this repository's path relative to `$HOME`
- Board filename strategy: project title plus ` Kanban.md`
- Kanban template path: `docs/agents/kanban-template.md`
- Local env file: `.env` (ignored)
- Env example: `.env.example`
- Tool config: `docs/agents/project-workflow.json`
- Verification command: `verify_project_workflow.mjs`
- Ticket sequence: `docs/agents/ticket-sequence.json`
- Execution plans: `docs/plans/*.md`

The board path mirrors the project path relative to the home directory. Keep the vault root in `.env`, not in committed docs.

## Path Portability

Never commit absolute local paths in git-tracked files, generated docs, Kanban cards, or linked plans. Use repo-relative paths for project files and environment variables such as `$HOME` and `$PROJECT_WORKFLOW_OBSIDIAN_VAULT` for machine-specific roots. Keep real absolute local paths only in ignored local files such as `.env`.

## Lanes

- `Backlog` means not started.
- `In Progress` means actively being worked.
- `Completed` means done.

The current ticket status is the card's lane on the Obsidian board. Do not encode current status in the plan file path.

## Ticket Format

When a skill says "publish to the issue tracker", use the ticket utility documented in `docs/agents/ticket-workflow.md`. It creates the Kanban card and linked plan file together.

Each ticket card should stay short and include:

- title line using the Kanban checkbox/card format, with the stable ticket ID first
- `## Description` with all tags and a 1-3 sentence summary
- `## Implementation Details` with `Ticket` and `Plan` bullets
- `## TODO Checklist`
- `## Acceptance Criteria`
- `## Verification`

Use this shape:

```markdown
- [ ] # <span style="color: #77ccd5">JS-0002 Ticket title</span>

    ## Description

    #needs-triage #optional-topic

    1-3 sentence summary.

    ## Implementation Details

    - Ticket: JS-0002
    - Plan: docs/plans/JS-0002-ticket-title.md

    ## TODO Checklist
    Items to implement:

    - [ ] First ticket-specific implementation step

    ## Acceptance Criteria

    - [ ] Observable ticket-specific result required for completion

    ## Verification

    Checks to run:

    - [ ] Ticket-specific command or review check
```

For implementation work, record longform context, plans, and completion notes in the linked `docs/plans/*.md` file. Keep the card scannable. A `#ready-for-agent` card must have ticket-specific TODO, Acceptance Criteria, and Verification items.

## Fetching Tickets

When a skill says "fetch the relevant ticket", read the referenced card in the Obsidian Kanban board and then read its linked plan file under `docs/plans/`. Use the card and plan as the source of truth for scope, TODOs, acceptance criteria, constraints, and verification.

## Pull Requests

External PRs are not currently treated as a request surface for this project. Track requested work in the Obsidian Kanban board unless the user explicitly says otherwise.

## Workflow Verification

Run this command after setup, after rerunning setup, and after resolving any protected-file merge:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/verify_project_workflow.mjs" --project-root "$PWD"
```

The setup command runs it automatically at the end of every non-dry-run setup.
