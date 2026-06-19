# Jonathan Lindquist Skills

Personal agent skills intended to be installed into `~/.agents/skills`.

This repo is a work in progress. Test workflow changes only against temporary projects and temporary Obsidian vaults, then remove the scratch files afterward.

## Skills

| Skill | Purpose |
| --- | --- |
| `setup-project-workflow` | Bootstrap repo-local agent docs, Obsidian Kanban ticket tracking, stable plan files, ticket numbering, and ticket status utilities. |

## Install

Clone the repo, then install the skills into `~/.agents/skills`:

```bash
git clone <this-repo-url> ~/jonathanLindquist-skills
cd ~/jonathanLindquist-skills
node scripts/install.mjs
```

By default, the installer creates per-skill symlinks from this repo into `~/.agents/skills`. Use `--mode copy` if you want a standalone copy instead:

```bash
node scripts/install.mjs --mode copy
```

Install one skill:

```bash
node scripts/install.mjs --skill setup-project-workflow
```

If your agent runtime reads another skills directory, install into that target explicitly:

```bash
node scripts/install.mjs --target "$HOME/.codex/skills"
```

The installer will not replace an existing skill directory unless you pass `--replace`.

## `setup-project-workflow` Requirements

Local tools:

- `node`, for the bundled `.mjs` workflow scripts.
- `git`, because the skill is designed for repository setup work.
- Obsidian, for the local issue tracker.
- The Obsidian Kanban plugin, for board lanes and tag colors.
- An agent runtime that can read skills from `~/.agents/skills`, or from whichever target you pass to the installer.

Each project that uses the skill must have an ignored `.env` file with:

```dotenv
PROJECT_WORKFLOW_OBSIDIAN_VAULT=/absolute/path/to/your/obsidian-vault
```

The skill intentionally reads this value from the project `.env` file only. It does not use process-level fallback env vars, `OBSIDIAN_VAULT`, a `--vault` flag, or an interactive prompt. The actual vault path is machine-specific and should not be committed.

Optional setup argument:

```bash
--ticket-prefix ABC
```

Use this when the derived ticket prefix is not what you want.

## Using `setup-project-workflow`

After installing, run it from the project you want to bootstrap:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/setup_project_workflow.mjs" \
  --project-root "$PWD" \
  --dry-run
```

Then run without `--dry-run` after the project `.env` has `PROJECT_WORKFLOW_OBSIDIAN_VAULT` set:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/setup_project_workflow.mjs" \
  --project-root "$PWD"
```

The skill creates or updates:

- `AGENTS.md`
- `CLAUDE.md`, as a thin pointer back to `AGENTS.md`
- `.env.example`
- `.gitignore`, ensuring `.env` is ignored
- `docs/agents/*`
- `docs/plans/*`
- an Obsidian Kanban board under the configured vault
- Obsidian Kanban tag color settings where available

Create a new ticket:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/new_project_ticket.mjs" \
  --project-root "$PWD" \
  --title "Ticket title" \
  --description "Short summary."
```

Move a ticket:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/update_project_ticket.mjs" \
  --project-root "$PWD" \
  --ticket "ABC-0002" \
  --lane "In Progress" \
  --note "Started implementation."
```

Complete a ticket:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/update_project_ticket.mjs" \
  --project-root "$PWD" \
  --ticket "ABC-0002" \
  --lane "Completed" \
  --complete \
  --note "Acceptance criteria verified."
```
