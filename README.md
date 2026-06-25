# Jonathan Lindquist Skills

Personal agent skills intended to be installed into `$HOME/.agents/skills`.

This repo is a work in progress. Test workflow changes only against temporary projects and temporary Obsidian vaults, then remove the scratch files afterward.

## Skills

| Skill | Purpose |
| --- | --- |
| `implement-review` | Implementation workflow that follows the normal test/review discipline before closeout. |
| `security-scan` | Manually triggered bundled SAST-style security scan that orchestrates 13 vendored detection checks as nested resources. |
| `setup-project-workflow` | Bootstrap repo-local agent docs, Obsidian Kanban ticket tracking, stable plan files, ticket numbering, and ticket status utilities. |

## Install

Clone the repo, then install the skills into `$HOME/.agents/skills`:

```bash
git clone <this-repo-url> "$HOME/jonathanLindquist-skills"
cd "$HOME/jonathanLindquist-skills"
pnpm install
node scripts/install.mjs
```

By default, the installer creates per-skill symlinks from this repo into `$HOME/.agents/skills`. Use `--mode copy` if you want a standalone copy instead:

```bash
node scripts/install.mjs --mode copy
```

Install one skill:

```bash
node scripts/install.mjs --skill setup-project-workflow
```

Install one skill and immediately sync provider-specific skill folders through `agent-sync`:

```bash
node scripts/install.mjs --skill setup-project-workflow --sync-providers
```

If your agent runtime reads another skills directory, install into that target explicitly:

```bash
node scripts/install.mjs --target "$HOME/.codex/skills"
```

The installer will not replace an existing skill directory unless you pass `--replace`.

## Update

When a skill is already installed in `$HOME/.agents/skills`, update one skill with:

```bash
node scripts/install.mjs --update --skill setup-project-workflow
```

`--update` is shorthand for `--replace --sync-providers` and requires one `--skill`. It replaces `$HOME/.agents/skills/setup-project-workflow` using the selected install mode, then runs:

```bash
agent-sync --all-providers --skill setup-project-workflow
```

By default, update mode installs a symlink to this repo. Add `--mode copy` when you want `$HOME/.agents/skills/setup-project-workflow` to be a standalone copy. Either way, `agent-sync` then refreshes provider-specific skill folders, such as Claude Code, for only the updated skill.

If `agent-sync` is not on `PATH`, pass its executable explicitly:

```bash
node scripts/install.mjs \
  --update \
  --skill setup-project-workflow \
  --agent-sync-bin "$HOME/.local/bin/agent-sync"
```

To sync a specific provider instead of every configured provider, repeat `--agent-sync-provider` with the provider flags you want:

```bash
node scripts/install.mjs \
  --update \
  --skill setup-project-workflow \
  --agent-sync-provider --claude-code
```

## `setup-project-workflow` Requirements

Local tools:

- `node`, for the bundled `.mjs` workflow scripts.
- `pnpm`, to install the required `agent-sync` dependency.
- `git`, because the skill is designed for repository setup work.
- Obsidian, for the local issue tracker.
- The Obsidian Kanban plugin, for board lanes and tag colors.
- `agent-sync`, installed from this repo's pinned package dependency, for refreshing provider-specific skill folders from `$HOME/.agents/skills`.
- An agent runtime that can read skills from `$HOME/.agents/skills`, or from whichever target you pass to the installer.

Each project that uses the skill must have an ignored `.env` file with:

```dotenv
PROJECT_WORKFLOW_OBSIDIAN_VAULT="$HOME/path/to/obsidian-vault"
```

The skill intentionally reads this value from the project `.env` file only. It does not use process-level fallback env vars, `OBSIDIAN_VAULT`, a `--vault` flag, or an interactive prompt. The actual vault path is machine-specific and should not be committed; committed docs and examples should use `$HOME`, `$PROJECT_WORKFLOW_OBSIDIAN_VAULT`, or repo-relative paths instead of local absolute paths.

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
- `.gitignore`, ensuring `.env` and `sast/` security-scan artifacts are ignored
- generated workflow docs under `docs/agents/`
- `docs/agents/ticket-sequence.json`, created once and preserved on reruns
- bootstrap and ticket plans under `docs/plans/`, created when missing and preserved on reruns
- `docs/agents/kanban-template.md`, refreshed from the skill's bundled template asset so the project carries its own Kanban template
- an Obsidian Kanban board under the configured vault
- Obsidian Kanban tag color settings where available

Non-dry-run setup always ends by running:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/verify_project_workflow.mjs" \
  --project-root "$PWD"
```

Run the same setup command again when this skill is enhanced and a project was already initialized. Reruns preserve `docs/agents/ticket-sequence.json`, reuse the existing ticket prefix, keep current board cards and linked plans, and refresh generated workflow docs, workflow config, and the repo-local Kanban template. Keep project-specific implementation history in Kanban cards, linked `docs/plans/*.md` files, or the non-managed portions of `AGENTS.md`; generated workflow docs are tool-owned and are rewritten by setup.

Create a new ticket:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/new_project_ticket.mjs" \
  --project-root "$PWD" \
  --title "Ticket title" \
  --description "Short summary." \
  --todo "First implementation step." \
  --acceptance "Observable result required for completion." \
  --verification "Command or review step that proves completion."
```

Title-only tickets are allowed as `#needs-triage` drafts with explicit placeholders. `--triage ready-for-agent` requires a real description plus at least one `--todo`, `--acceptance`, and `--verification` field.

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
