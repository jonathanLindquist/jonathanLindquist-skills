---
name: setup-project-workflow
description: >-
  Set up a repo with the user's standard project workflow: canonical AGENTS.md,
  thin CLAUDE.md pointer, repo-local docs/agents guidance, stable execution
  plans under docs/plans, ticket IDs backed by
  docs/agents/ticket-sequence.json, Obsidian Kanban issue tracking from
  PROJECT_WORKFLOW_OBSIDIAN_VAULT, public-safe .env.example/.env setup, and
  configured Kanban tag colors. Use when the user asks to initialize a new
  project/repo, set up project workflow, apply this project workflow pattern,
  create the Obsidian issue tracker for a repo, or make a new repo ready for
  the engineering skills.
disable-model-invocation: true
---

# Setup Project Workflow

Bootstrap a project so future agents use the same durable local workflow:

- `AGENTS.md` is the source of truth for repo-local agent guidance.
- `CLAUDE.md` is only a thin pointer back to `AGENTS.md`.
- `docs/agents/` records issue tracker, ticket workflow, triage tag, and domain-doc conventions.
- `docs/agents/project-workflow.json` is the machine-readable workflow config.
- `docs/agents/ticket-sequence.json` stores the committed per-project ticket sequence.
- `docs/agents/kanban-template.md` stores the repo-local Obsidian Kanban template copied from this skill's bundled asset.
- Execution plan Markdown files live at stable paths directly under `docs/plans/`, for example `docs/plans/HAG-0001-ticket-title.md`.
- Lane-named plan folders such as `docs/plans/Backlog/`, `docs/plans/In Progress/`, and `docs/plans/Completed/` are legacy. Do not create new plans there.
- Ticket work must begin by reading the Kanban card and linked plan, and it is not complete until the plan has completion notes and the Kanban card is moved to `Completed` with applicable TODO/Definition of Done boxes checked.
- The issue tracker is an Obsidian Kanban board under `$PROJECT_WORKFLOW_OBSIDIAN_VAULT`, with a folder path that mirrors the project path relative to `$HOME`.
- `.env.example` documents required local settings; ignored `.env` stores the actual vault root and is required before setup can finish.
- Triage roles are Obsidian tags with Kanban plugin colors.

## Workflow

1. Inspect the repo root before writing:
   - `git rev-parse --show-toplevel`
   - `AGENTS.md`
   - `CLAUDE.md`
   - `docs/agents/`
   - `docs/plans/`
   - `CONTEXT.md`
   - `docs/adr/`
2. If `.env` does not already define `PROJECT_WORKFLOW_OBSIDIAN_VAULT`, ask the user for the Obsidian vault root and write it to ignored `.env` before setup. The setup script does not read process-level fallback env vars for required local config.
3. Run the bundled setup script from the target repo root. Prefer a dry run first when the user asks to preview changes.

   ```bash
   node "$HOME/.agents/skills/setup-project-workflow/scripts/setup_project_workflow.mjs" --project-root "$PWD"
   ```

   Useful options:

   ```bash
   node "$HOME/.agents/skills/setup-project-workflow/scripts/setup_project_workflow.mjs" --project-root "$PWD" --dry-run
   node "$HOME/.agents/skills/setup-project-workflow/scripts/setup_project_workflow.mjs" --project-root "$PWD" --force
   node "$HOME/.agents/skills/setup-project-workflow/scripts/setup_project_workflow.mjs" --project-root "$PWD" --ticket-prefix HAG
   ```

4. If existing generated docs differ and the script reports a skip, inspect the existing file and merge project-specific content into `AGENTS.md`. Use `--force` only after preserving anything the user needs.
5. Verify the board and docs:
   - The board exists under the vault path mirroring the project path relative to `$HOME`.
   - `.env.example` documents `PROJECT_WORKFLOW_OBSIDIAN_VAULT`.
   - `.env` exists locally, is gitignored, and contains the actual vault root.
   - The board and `docs/agents/kanban-template.md` both include `tag-colors` in their `%% kanban:settings` blocks.
   - The vault-wide Kanban plugin settings include the same `tag-colors` entries.
   - `AGENTS.md` contains exactly one `## Agent skills` section.
   - `CLAUDE.md` remains a pointer to `AGENTS.md`.
   - `docs/agents/project-workflow.json` describes the board derivation strategy, repo-local Kanban template, plan directory, and ticket sequence file.
   - `docs/agents/ticket-sequence.json` exists and is not reset on reruns.
   - The bootstrap card has a ticket ID and linked plan file under `docs/plans/`.
   - Generated `AGENTS.md` and `docs/agents/ticket-workflow.md` include the ticket start and completion closeout rules.

## Generated Pattern

For a repo at `$HOME/projects/utilities/example-tool`, create:

```text
$HOME/projects/utilities/example-tool/
|-- AGENTS.md
|-- CLAUDE.md
|-- .env.example
|-- .gitignore
`-- docs/
    |-- agents/
    |   |-- domain.md
    |   |-- issue-tracker.md
    |   |-- kanban-template.md
    |   |-- project-workflow.json
    |   |-- ticket-sequence.json
    |   |-- ticket-workflow.md
    |   `-- triage-labels.md
    `-- plans/
        `-- ET-0001-initialize-project-workflow.md
```

And create or update under `$PROJECT_WORKFLOW_OBSIDIAN_VAULT`:

```text
$PROJECT_WORKFLOW_OBSIDIAN_VAULT/
|-- .obsidian/plugins/obsidian-kanban/data.json
`-- projects/utilities/example-tool/Example Tool Kanban.md
```

## Creating Tickets

After setup, create tickets with:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/new_project_ticket.mjs" \
  --project-root "$PWD" \
  --title "Ticket title" \
  --description "Short 1-3 sentence summary." \
  --tag optional-topic
```

Only `--title` is required. The utility defaults to `Backlog`, `#needs-triage`, appends to the bottom of the lane, creates the linked plan file, and advances `docs/agents/ticket-sequence.json`.

Update ticket status with:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/update_project_ticket.mjs" \
  --project-root "$PWD" \
  --ticket "HAG-0002" \
  --lane "In Progress" \
  --note "Started implementation after changing code."
```

After implementation code changes, move the ticket to `In Progress` unless it is already complete. When acceptance criteria are complete, rerun the utility with `--lane "Completed" --complete` and a completion note.

## Kanban Tags

Use these five canonical triage tags:

| Role | Tag | Color |
| --- | --- | --- |
| `needs-triage` | `#needs-triage` | Amber |
| `needs-info` | `#needs-info` | Blue |
| `ready-for-agent` | `#ready-for-agent` | Violet |
| `ready-for-human` | `#ready-for-human` | Pink |
| `wontfix` | `#wontfix` | Red |

Put tags in the card's `Description` section. Do not use a `Triage:` bullet.

Configure colors in Kanban settings using both `#tag` and `tag` keys. Some Kanban plugin versions look up the link target with the hash and others without it.

Update:

```text
$PROJECT_WORKFLOW_OBSIDIAN_VAULT/
`-- .obsidian/plugins/obsidian-kanban/data.json
```

## Operating Rules

- Do not use GitHub Issues unless the user explicitly asks to switch this project away from Obsidian.
- Do not make `CLAUDE.md` a second source of truth. Move shared guidance into `AGENTS.md`.
- Do not flag missing `CONTEXT.md` or `docs/adr/` as a problem. The generated domain doc tells agents to read them if they exist and proceed silently if they do not.
- Do not overwrite substantive existing `CLAUDE.md` content without preserving it in `AGENTS.md` first.
- Do not commit machine-specific vault paths. Keep the actual vault root in ignored `.env` as `PROJECT_WORKFLOW_OBSIDIAN_VAULT`; committed docs should describe derivation from `$HOME` and that env var.
- Do not rely on process-level fallback env vars for required local config. If `.env` is missing or incomplete, stop and ask the user to populate it.
- Do not reset an existing `docs/agents/ticket-sequence.json`.
- Store execution plan Markdown files directly under `docs/plans/` with stable ticket-ID filenames.
- Treat `docs/plans/*.md` as long-lived project history, not disposable scratch.
- When generated instructions describe ticket work, require agents to read the card and linked plan before implementation, update the Kanban lane after implementation code changes, verify Definition of Done or acceptance criteria before closeout, append completion notes to the linked plan, move the card to `Completed`, check applicable TODO/DoD boxes, and re-read the board to confirm the lane.
- When setup work is complete, leave the bootstrap implementation card in the Kanban board's `Completed` lane with a concrete ticket ID and verification data.
