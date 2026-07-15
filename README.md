# Jonathan Lindquist Skills

Personal agent skills for practical software engineering work. The installable
skills live under `skills/` and are intended to be installed into
`$HOME/.agents/skills`, or another agent skills directory you choose.

This repo is a work in progress. Test workflow changes only against temporary
projects and temporary Obsidian vaults, then remove the scratch files afterward.

## Skill Catalog

| Skill | Status | Use it when | What it does |
| --- | --- | --- | --- |
| `implement-jl` | Deprecated | You want an agent to implement a ticket, feature, bug fix, or refactor with JL's engineering discipline. | Reads the source request, identifies the test seam, makes scoped changes, updates tests where appropriate, runs checks, and reports verification. |
| `review-jl` | Deprecated | You want a JL code review, implementation review, PR review, branch audit, or post-implementation review. | Launches the Thermos security/correctness and code-quality rubrics in subagents, collects their findings, verifies high-signal issues, and returns a concise findings-first review. |
| `security-scan` | Active | You explicitly ask for a SAST-style security scan or vulnerability review. | Orchestrates 13 vendored vulnerability-detection checks, writes scan artifacts under `sast/`, and consolidates confirmed and likely findings. |
| `setup-project-workflow` | Active | You want to bootstrap or refresh repo-local agent workflow docs and an Obsidian Kanban issue tracker. | Creates `AGENTS.md`, generated docs under `docs/agents/`, stable plans under `docs/plans/`, ticket utilities, verification checks, and the mirrored Obsidian board. |
| `to-spec-jl` | Active | You explicitly want to turn a conversation into a durable epic spec or PRD. | Writes a fully formed implementation spec under `docs/spec/` or an established docs/prd convention without creating an issue-tracker ticket. |

`to-spec-jl` keeps specification and ticket creation separate. After reviewing
the spec, invoke `$to-tickets <spec-path>` independently to break it into small
tracker tickets with blocking relationships.

`security-scan` contains nested SAST detection skills under
`skills/security-scan/subskills/`. They are resources for the orchestrator and
are not installed as top-level skills.

## Install

Clone the repo, install dependencies, then install every skill into
`$HOME/.agents/skills`:

```bash
git clone <this-repo-url> "$HOME/jonathanLindquist-skills"
cd "$HOME/jonathanLindquist-skills"
pnpm install
node scripts/install.mjs
```

No separate or global `agent-sync` installation is required. `pnpm install`
installs the pinned version used by both provider sync and provider-link
cleanup.

The installer creates per-skill symlinks from `skills/<name>` into
`$HOME/.agents/skills/<name>`. Re-running an install whose destination already
links to the same repo skill is a successful no-op.

Skills with `metadata.deprecated: "true"` in `SKILL.md` are skipped before
dependency checks, receipt changes, symlink creation, or provider sync. An
explicit `--skill` or `--update` request for one of those skills also succeeds
as a logged skip. Previously installed copies are not removed automatically.

Install one skill:

```bash
node scripts/install.mjs --skill setup-project-workflow
```

Install one skill and immediately sync provider-specific skill folders through
`agent-sync`:

```bash
node scripts/install.mjs --skill setup-project-workflow --sync-providers
```

Provider sync is allowed only when the install target is a skills `sourceDir`
in the selected `agent-sync` config. The pinned config is the default. If a
custom executable uses another config, also pass `--agent-sync-config <path>`
so the installer can validate the source and record the destinations it
actually observes. This option describes the executable's config; it does not
change how that executable selects its own config.

If your agent runtime reads another skills directory, install into that target
explicitly:

```bash
node scripts/install.mjs --target "$HOME/.codex/skills"
```

The installer will not replace an existing skill directory unless you pass
`--replace`.

Successful installs are recorded in a hidden receipt in the target skills
directory. It records the repo source and any ownership-verified provider
destinations observed after `--sync-providers`. That history lets uninstall
clean up an old provider destination even if the current `agent-sync` config
has since changed. The receipt never authorizes removing a real directory;
new installations and uninstall ownership are symlink-only.

The installer verifies machine-readable skill dependencies before installing
the selected active skills. `review-jl` retains its Thermos dependency contract
in `skills/review-jl/dependencies.json`, but is currently deprecated and is
therefore skipped before that dependency check runs.

## Update

When a skill is already installed in `$HOME/.agents/skills`, update one skill
with:

```bash
node scripts/install.mjs --update --skill setup-project-workflow
```

`--update` is shorthand for `--replace --sync-providers` and requires one
`--skill`. It ensures `$HOME/.agents/skills/setup-project-workflow` links to the
repo skill, then runs:

```bash
agent-sync --all-providers --skill setup-project-workflow
```

`agent-sync` then refreshes provider-specific skill folders, such as Claude
Code, for only the updated skill.

If `agent-sync` is not on `PATH`, pass its executable explicitly:

```bash
node scripts/install.mjs \
  --update \
  --skill setup-project-workflow \
  --agent-sync-bin "$HOME/.local/bin/agent-sync"
```

To sync a specific provider instead of every configured provider, repeat
`--agent-sync-provider` with the provider flags you want:

```bash
node scripts/install.mjs \
  --update \
  --skill setup-project-workflow \
  --agent-sync-provider --claude-code
```

## Uninstall

Uninstall unlinks per-skill entries without touching this repository's source
directories. A same-named real directory or a symlink to another source is
never treated as an owned installation.

Uninstall one skill, several skills, or every skill owned by this repository:

```bash
node scripts/uninstall.mjs --skill setup-project-workflow
node scripts/uninstall.mjs --skill implement-jl,review-jl
node scripts/uninstall.mjs --all
```

`--skill` accepts one name or a comma-separated list and may be repeated.

Pass the same custom target used at install time when applicable:

```bash
node scripts/uninstall.mjs \
  --skill setup-project-workflow \
  --target "$HOME/.codex/skills"
```

`--all` is explicit because uninstalling is destructive. It selects receipted
installs and provably repo-owned primary or provider symlinks; it never removes
every entry in the target directory. A missing explicit skill is an idempotent
no-op. A foreign same-named primary entry is rejected before any selected skill
is changed.

Preview the complete plan without changing files:

```bash
node scripts/uninstall.mjs --all --dry-run
```

If installation used `--sync-providers`, remove the verified provider symlinks
at the same time:

```bash
node scripts/uninstall.mjs \
  --skill setup-project-workflow \
  --remove-provider-links
```

Provider links are unlinked directly, before the primary installation. The
uninstaller uses `agent-sync`'s own config loader, selects every skills artifact
whose physical `sourceDir` matches the uninstall target, and deduplicates its
provider destinations by physical path. It unions those current destinations
with any destinations recorded after earlier successful syncs. The pinned
config currently maps `$HOME/.agents/skills` to `$HOME/.claude/skills`.

Each provider entry must be a symlink whose target exactly matches the repo
skill source, the primary install, or a recorded/configured source path. Missing
entries are no-ops. Foreign symlinks and real directories are preserved and
reported, so they do not block cleanup of owned links. Config parse failures
remain fatal because otherwise the command could falsely claim that provider
cleanup was complete. Use `--agent-sync-config <path>` for a legacy install that
predates provider receipts or used a different config. The uninstaller never
runs `agent-sync`; doing so after primary removal could import a provider entry
back into the source directory.

## Repository Layout

```text
skills/
  implement-jl/
  review-jl/
  security-scan/
    subskills/
  setup-project-workflow/
  to-spec-jl/
scripts/
  install.mjs
  install_receipt.mjs
  provider_config.mjs
  skill_metadata.mjs
  uninstall.mjs
test/
docs/agents/
docs/plans/
```

Only active direct children of `skills/` with a `SKILL.md` are installed.
Top-level skills declare their status with `metadata.deprecated` in their
frontmatter. Nested resources, such as `skills/security-scan/subskills/*`, stay
bundled inside their parent skill.

## `review-jl` Requirements

`review-jl` requires the Thermos plugin from `jonathanLindquist-plugins` with
these capabilities:

- `thermo-nuclear-review`
- `thermo-nuclear-code-quality-review`

Install the plugin for Codex, then start a fresh Codex thread so the skills are
visible:

```bash
codex plugin marketplace add <jonathanLindquist-plugins repo>
codex plugin add thermos@jonathanlindquist-plugins
```

Verify the dependency contract from this repo with:

```bash
node scripts/verify_skill_dependencies.mjs --skill review-jl
```

## `setup-project-workflow` Requirements

Local tools:

- `node`, for the bundled `.mjs` workflow scripts.
- `pnpm`, to install the required `agent-sync` dependency.
- `git`, because the skill is designed for repository setup work.
- Obsidian, for the local issue tracker.
- The Obsidian Kanban plugin, for board lanes and tag colors.
- `agent-sync`, installed from this repo's pinned package dependency, for
  refreshing provider-specific skill folders from `$HOME/.agents/skills`.
- An agent runtime that can read skills from `$HOME/.agents/skills`, or from
  whichever target you pass to the installer.

Each project that uses the skill must have an ignored `.env` file with:

```dotenv
PROJECT_WORKFLOW_OBSIDIAN_VAULT="$HOME/path/to/obsidian-vault"
```

The skill intentionally reads this value from the project `.env` file only. It
does not use process-level fallback env vars, `OBSIDIAN_VAULT`, a `--vault`
flag, or an interactive prompt. The actual vault path is machine-specific and
should not be committed; committed docs and examples should use `$HOME`,
`$PROJECT_WORKFLOW_OBSIDIAN_VAULT`, or repo-relative paths instead of local
absolute paths.

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

Then run without `--dry-run` after the project `.env` has
`PROJECT_WORKFLOW_OBSIDIAN_VAULT` set:

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
- bootstrap and ticket plans under `docs/plans/`, created when missing and
  preserved on reruns
- `docs/agents/kanban-template.md`, refreshed from the skill's bundled template
  asset so the project carries its own Kanban template
- an Obsidian Kanban board under the configured vault
- Obsidian Kanban tag color settings where available

Non-dry-run setup always ends by running:

```bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/verify_project_workflow.mjs" \
  --project-root "$PWD"
```

Run the same setup command again when this skill is enhanced and a project was
already initialized. Reruns preserve `docs/agents/ticket-sequence.json`, reuse
the existing ticket prefix, keep current board cards and linked plans, and
refresh generated workflow docs, workflow config, and the repo-local Kanban
template. Keep project-specific implementation history in Kanban cards, linked
`docs/plans/*.md` files, or the non-managed portions of `AGENTS.md`; generated
workflow docs are tool-owned and are rewritten by setup.

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

Title-only tickets are allowed as `#needs-triage` drafts with explicit
placeholders. `--triage ready-for-agent` requires a real description plus at
least one `--todo`, `--acceptance`, and `--verification` field.

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

## Development

Run focused tests while changing a behavior area, then run the full checks:

```bash
pnpm test
pnpm run lint
```

Useful focused checks:

```bash
node --test test/install.test.mjs
node --test test/uninstall.test.mjs
node --test test/security-scan.test.mjs
node --test test/setup-project-workflow.test.mjs
```

Installer behavior is intentionally covered by tests because the source layout
and installed runtime layout differ: source skills live under `skills/`, while
installed skills still land directly under the target skills directory.

## Credits

- The bundled SAST detection checks are vendored from
  [Utku Sen's `utkusen/sast-skills`](https://github.com/utkusen/sast-skills)
  and kept under their MIT license. The vendored license is included at
  `skills/security-scan/subskills/utkusen-sast-skills-LICENSE`.
- Several workflow ideas in this repo are inspired by
  [Matt Pocock's `mattpocock/skills`](https://github.com/mattpocock/skills) and
  his AI engineering writing at [AI Hero](https://www.aihero.dev/).
