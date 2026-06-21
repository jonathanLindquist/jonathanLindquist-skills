# Jonathan Lindquist Skills

Personal agent skills intended to be installed into `~/.agents/skills`.

This repo is a work in progress. Test workflow changes only against temporary projects and temporary Obsidian vaults, then remove the scratch files afterward.

## Skills

| Skill | Purpose |
| --- | --- |
| `setup-project-workflow` | Bootstrap repo-local agent docs, Obsidian Kanban ticket tracking, stable plan files, ticket numbering, ticket status utilities, and optional Codex auto-compaction scaffolding. |

## Install

Clone the repo, then install the skills into `~/.agents/skills`:

```bash
git clone <this-repo-url> ~/jonathanLindquist-skills
cd ~/jonathanLindquist-skills
npm install
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

Install one skill and immediately sync provider-specific skill folders through `skill-organizer`:

```bash
node scripts/install.mjs --skill setup-project-workflow --sync-providers
```

If your agent runtime reads another skills directory, install into that target explicitly:

```bash
node scripts/install.mjs --target "$HOME/.codex/skills"
```

The installer will not replace an existing skill directory unless you pass `--replace`.

## Update

When a skill is already installed in `~/.agents/skills`, update one skill with:

```bash
node scripts/install.mjs --update --skill setup-project-workflow
```

`--update` is shorthand for `--replace --sync-providers` and requires one `--skill`. It replaces `~/.agents/skills/setup-project-workflow` using the selected install mode, then runs:

```bash
skill-organizer --all-providers --skill setup-project-workflow
```

By default, update mode installs a symlink to this repo. Add `--mode copy` when you want `~/.agents/skills/setup-project-workflow` to be a standalone copy. Either way, `skill-organizer` then refreshes provider-specific skill folders, such as Claude Code, for only the updated skill.

If `skill-organizer` is not on `PATH`, pass its executable explicitly:

```bash
node scripts/install.mjs \
  --update \
  --skill setup-project-workflow \
  --organizer-bin /path/to/skill-organizer
```

To sync a specific provider instead of every configured provider, repeat `--organizer-provider` with the provider flags you want:

```bash
node scripts/install.mjs \
  --update \
  --skill setup-project-workflow \
  --organizer-provider --claude-code
```

## `setup-project-workflow` Requirements

Local tools:

- `node`, for the bundled `.mjs` workflow scripts.
- `npm`, to install the required `skill-organizer` dependency.
- `git`, because the skill is designed for repository setup work.
- Obsidian, for the local issue tracker.
- The Obsidian Kanban plugin, for board lanes and tag colors.
- `skill-organizer`, installed from this repo's pinned package dependency, for refreshing provider-specific skill folders from `~/.agents/skills`.
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

Optional Codex auto-compaction arguments:

```bash
--enable-codex-auto-compact
--disable-codex-auto-compact
--codex-context-window 128000
--codex-auto-compact-threshold-percent 55
```

Use these when a project should opt into project-local Codex compaction before the context window is heavily saturated. The threshold percent must stay below `60`; the setup script converts it to Codex's absolute `model_auto_compact_token_limit`.

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
- `docs/agents/kanban-template.md`, copied from the skill's bundled template asset so the project carries its own Kanban template
- `docs/agents/codex-auto-compact.md`, documenting current Codex auto-compaction state and caveats
- an Obsidian Kanban board under the configured vault
- Obsidian Kanban tag color settings where available

When `--enable-codex-auto-compact` is passed, the skill also creates or updates:

- `.codex/config.toml`, with a managed setup block for `model_auto_compact_token_limit`, `experimental_compact_prompt_file`, and a `PreCompact` hook matching `auto`
- `.codex/compact-prompt.md`
- `.codex/hooks/write_compaction_handoff.mjs`
- `.gitignore`, ensuring `.codex/handoffs/` is ignored

Limitations: project `.codex/config.toml` loads only for trusted projects, and current Codex `PreCompact` matchers distinguish `manual` versus `auto`, not main-agent versus subagent sessions. For strict main-agent-only behavior, use a personal Codex profile for main sessions and separate custom subagent configs.

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
