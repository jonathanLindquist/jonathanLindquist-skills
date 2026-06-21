import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bundledKanbanTemplatePath = path.resolve(scriptDir, "..", "assets", "kanban-template.md");
const repoKanbanTemplatePath = "docs/agents/kanban-template.md";
const homeDir = os.homedir();
const vaultEnvVar = "PROJECT_WORKFLOW_OBSIDIAN_VAULT";
const defaultLanes = ["Backlog", "In Progress", "Completed"];
const ticketWidth = 4;
const bootstrapTicketNumber = 1;
const bootstrapTitle = "Initialize Project Workflow";
const bootstrapTriageTag = "ready-for-agent";
const bootstrapTopicTags = ["obsidian", "kanban"];
const codexAutoCompactDefaults = {
  contextWindowTokens: 128000,
  thresholdPercent: 55,
};
const codexAutoCompactPaths = {
  config: ".codex/config.toml",
  prompt: ".codex/compact-prompt.md",
  hook: ".codex/hooks/write_compaction_handoff.mjs",
  latestHandoff: ".codex/handoffs/latest.md",
};
const codexAutoCompactBlockStart = "# setup-project-workflow: codex-auto-compact begin";
const codexAutoCompactBlockEnd = "# setup-project-workflow: codex-auto-compact end";

const triageTags = [
  {
    role: "needs-triage",
    tag: "needs-triage",
    colorName: "Amber",
    color: "#111827",
    backgroundColor: "#f59e0b",
    meaning: "Maintainer needs to evaluate this issue",
  },
  {
    role: "needs-info",
    tag: "needs-info",
    colorName: "Blue",
    color: "#0f172a",
    backgroundColor: "#38bdf8",
    meaning: "Waiting on reporter for more information",
  },
  {
    role: "ready-for-agent",
    tag: "ready-for-agent",
    colorName: "Violet",
    color: "#ffffff",
    backgroundColor: "#8b5cf6",
    meaning: "Fully specified, ready for an agent",
  },
  {
    role: "ready-for-human",
    tag: "ready-for-human",
    colorName: "Pink",
    color: "#500724",
    backgroundColor: "#f472b6",
    meaning: "Requires human implementation",
  },
  {
    role: "wontfix",
    tag: "wontfix",
    colorName: "Red",
    color: "#ffffff",
    backgroundColor: "#ef4444",
    meaning: "Will not be actioned",
  },
];

const commonTags = [
  ["cli", "#312e81", "#a5b4fc"],
  ["sync", "#064e3b", "#6ee7b7"],
  ["tests", "#7c2d12", "#fdba74"],
  ["obsidian", "#581c87", "#d8b4fe"],
  ["kanban", "#164e63", "#67e8f9"],
  ["triage", "#451a03", "#fbbf24"],
];

const usage = `Usage:
  setup_project_workflow.mjs [options]

Options:
  --project-root <path>    Repo/project root to set up. Defaults to cwd.
  --ticket-prefix <value>  Ticket prefix. Defaults to initials from the project name.
  --dry-run                Print planned writes without changing files.
  --force                  Overwrite generated docs and non-wrapper CLAUDE.md.
  --enable-codex-auto-compact
                           Scaffold project-local Codex config for earlier auto-compaction.
  --disable-codex-auto-compact
                           Remove the managed project-local Codex auto-compaction config block.
  --codex-context-window <tokens>
                           Context window used to compute the compact token limit. Defaults to 128000.
  --codex-auto-compact-threshold-percent <percent>
                           Percentage of context to compact at. Must be below 60. Defaults to 55.
  --help                   Show this help.
`;

function parseArgs(argv) {
  const options = {
    projectRoot: process.cwd(),
    ticketPrefix: null,
    dryRun: false,
    force: false,
    codexAutoCompactEnabled: null,
    codexContextWindowTokens: null,
    codexAutoCompactThresholdPercent: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--project-root") {
      options.projectRoot = argv[++index];
    } else if (arg === "--ticket-prefix") {
      options.ticketPrefix = normalizeTicketPrefix(argv[++index]);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--enable-codex-auto-compact") {
      options.codexAutoCompactEnabled = true;
    } else if (arg === "--disable-codex-auto-compact") {
      options.codexAutoCompactEnabled = false;
    } else if (arg === "--codex-context-window") {
      options.codexContextWindowTokens = parsePositiveInteger(argv[++index], arg);
    } else if (arg === "--codex-auto-compact-threshold-percent") {
      options.codexAutoCompactThresholdPercent = parseCompactThresholdPercent(argv[++index], arg);
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage}`);
    }
  }

  options.projectRoot = path.resolve(expandHome(options.projectRoot));

  return options;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${flag} ${value}. Expected a positive integer.`);
  }
  return parsed;
}

function parseCompactThresholdPercent(value, flag) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 60) {
    throw new Error(`Invalid ${flag} ${value}. Expected a number greater than 0 and below 60.`);
  }
  return parsed;
}

function expandHome(value) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return path.join(homeDir, value.slice(2));
  return value;
}

function displayPath(value) {
  const relative = path.relative(homeDir, value);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `~/${relative}`;
  }
  return value;
}

function projectRelativePath(projectRoot) {
  const relative = path.relative(homeDir, projectRoot);

  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }

  return path.join("external-projects", path.basename(projectRoot));
}

function boardReference() {
  return `derived from \`$${vaultEnvVar}\` and this repository's path relative to \`$HOME\``;
}

function parseEnv(content) {
  const values = new Map();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    values.set(match[1], unquoteEnvValue(match[2].trim()));
  }

  return values;
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function readProjectEnv(projectRoot) {
  const envPath = path.join(projectRoot, ".env");
  const content = readFileIfExists(envPath);
  return content === null ? new Map() : parseEnv(content);
}

function resolveRequiredVault(projectRoot, projectEnv, options) {
  const value = projectEnv.get(vaultEnvVar);

  if (!value || !value.trim()) {
    const exampleMessage = options.dryRun
      ? "This dry run would create or update .env.example before stopping."
      : "If .env.example was missing, this command created it before stopping.";

    throw new Error(
      [
        `Missing required local config: ${vaultEnvVar}.`,
        `Create ${path.join(projectRoot, ".env")} from .env.example and set ${vaultEnvVar} to your Obsidian vault root.`,
        exampleMessage,
        "Then rerun setup_project_workflow.mjs.",
      ].join("\n"),
    );
  }

  return path.resolve(expandHome(value.trim()));
}

function titleCase(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizeTicketPrefix(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function defaultTicketPrefix(projectName) {
  const words = projectName
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.trim())
    .filter(Boolean);

  const prefix =
    words.length > 1
      ? words.map((word) => word[0]).join("")
      : (words[0] ?? projectName).slice(0, 3);

  return normalizeTicketPrefix(prefix || "TKT");
}

function ticketId(prefix, number, width = ticketWidth) {
  return `${prefix}-${String(number).padStart(width, "0")}`;
}

function ticketPlanFileName(id, title) {
  return `${id}-${slugify(title)}.md`;
}

function ensureDir(dir, options, actions) {
  if (fs.existsSync(dir)) return;
  actions.push(`create dir ${displayPath(dir)}`);
  if (!options.dryRun) fs.mkdirSync(dir, { recursive: true });
}

function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

function writeIfChanged(filePath, content, options, actions) {
  const current = readFileIfExists(filePath);
  if (current === content) {
    actions.push(`unchanged ${displayPath(filePath)}`);
    return "unchanged";
  }

  ensureDir(path.dirname(filePath), options, actions);
  actions.push(`${current === null ? "create" : "update"} ${displayPath(filePath)}`);

  if (!options.dryRun) {
    fs.writeFileSync(filePath, content);
  }

  return current === null ? "created" : "updated";
}

function writeGeneratedFile(filePath, content, options, actions) {
  const current = readFileIfExists(filePath);

  if (current !== null && current !== content && !options.force) {
    actions.push(
      `skip existing ${displayPath(filePath)}; rerun with --force after preserving project-specific edits`,
    );
    return "skipped";
  }

  return writeIfChanged(filePath, content, options, actions);
}

function writeStateFileIfMissing(filePath, content, options, actions) {
  if (readFileIfExists(filePath) !== null) {
    actions.push(`preserve existing ${displayPath(filePath)}`);
    return "preserved";
  }

  return writeIfChanged(filePath, content, options, actions);
}

function envExample() {
  return `# Local machine configuration for setup-project-workflow.
# Copy this file to .env and fill in the required values before running setup.
# Do not commit .env. It contains machine-specific paths.

${envExampleSnippet()}`;
}

function envExampleSnippet() {
  return `# setup-project-workflow: root path to the Obsidian vault that should contain this project's Kanban board.
# Use an absolute path or a ~ path.
${vaultEnvVar}=
`;
}

function updateEnvExampleFile(projectRoot, options, actions) {
  const envExamplePath = path.join(projectRoot, ".env.example");
  const current = readFileIfExists(envExamplePath);

  if (current === null) {
    writeIfChanged(envExamplePath, envExample(), options, actions);
    return;
  }

  if (envLinePattern(vaultEnvVar).test(current)) {
    actions.push(`unchanged ${displayPath(envExamplePath)}`);
    return;
  }

  const separator = current.endsWith("\n") ? "\n" : "\n\n";
  writeIfChanged(envExamplePath, `${current}${separator}${envExampleSnippet()}`, options, actions);
}

function envLinePattern(key) {
  return new RegExp(`^${key}=.*$`, "m");
}

function gitignoreIgnoresEnv(markdown) {
  return markdown.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed === ".env" || trimmed === ".env*";
  });
}

function updateGitignore(projectRoot, options, actions) {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const current = readFileIfExists(gitignorePath);

  if (current !== null && gitignoreIgnoresEnv(current)) {
    actions.push(`unchanged ${displayPath(gitignorePath)}`);
    return;
  }

  const base = current === null ? "" : current.trimEnd();
  const prefix = base ? `${base}\n\n` : "";
  writeIfChanged(
    gitignorePath,
    `${prefix}# Local machine configuration\n.env\n`,
    options,
    actions,
  );
}

function updateGitignorePattern(projectRoot, pattern, options, actions) {
  const gitignorePath = path.join(projectRoot, ".gitignore");
  const current = readFileIfExists(gitignorePath);

  if (current !== null && current.split(/\r?\n/).some((line) => line.trim() === pattern)) {
    actions.push(`unchanged ${displayPath(gitignorePath)}`);
    return;
  }

  const base = current === null ? "" : current.trimEnd();
  const prefix = base ? `${base}\n\n` : "";
  writeIfChanged(gitignorePath, `${prefix}# Codex runtime handoffs\n${pattern}\n`, options, actions);
}

function updateLocalConfigFiles(projectRoot, options, actions) {
  updateEnvExampleFile(projectRoot, options, actions);
  updateGitignore(projectRoot, options, actions);
}

function tagColorEntries() {
  const tagsByName = new Map();
  const addTag = ([tag, color, backgroundColor]) => {
    if (tag) tagsByName.set(tag, [tag, color, backgroundColor]);
  };

  for (const tag of triageTags) {
    addTag([tag.tag, tag.color, tag.backgroundColor]);
  }

  for (const tag of commonTags) {
    addTag(tag);
  }

  return [...tagsByName.values()].flatMap(([tag, color, backgroundColor]) => [
    { tagKey: `#${tag}`, color, backgroundColor },
    { tagKey: tag, color, backgroundColor },
  ]);
}

function mergeTagColors(existing) {
  const byKey = new Map();

  for (const color of Array.isArray(existing) ? existing : []) {
    if (color && typeof color.tagKey === "string") {
      byKey.set(color.tagKey, color);
    }
  }

  for (const color of tagColorEntries()) {
    byKey.set(color.tagKey, color);
  }

  return [...byKey.values()];
}

function applyKanbanSettings(settings) {
  return {
    ...settings,
    "move-tags": true,
    "tag-action": "kanban",
    "tag-colors": mergeTagColors(settings["tag-colors"]),
  };
}

function settingsBlock(settings, fenceLanguage = "") {
  return `%% kanban:settings
\`\`\`${fenceLanguage}
${JSON.stringify(applyKanbanSettings(settings), null, 2)}
\`\`\`
%%`;
}

function extractSettings(markdown) {
  const match = markdown.match(/%% kanban:settings\n```([^\n]*)\n([\s\S]*?)\n```\n%%/);
  if (!match) return { settings: {}, fenceLanguage: "" };

  return {
    settings: JSON.parse(match[2]),
    fenceLanguage: match[1],
  };
}

function extractLanes(markdown) {
  const lanes = [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
  return lanes.length > 0 ? lanes : defaultLanes;
}

function lanesWithCompleted(lanes) {
  return lanes.includes("Completed") ? lanes : [...lanes, "Completed"];
}

function updateMarkdownSettings(markdown) {
  const pattern = /%% kanban:settings\n```([^\n]*)\n([\s\S]*?)\n```\n%%/;
  const match = markdown.match(pattern);

  if (!match) {
    return `${markdown.trimEnd()}\n\n\n${settingsBlock({
      "kanban-plugin": "board",
      "list-collapse": [false, false, false],
      "lane-width": 400,
    })}\n`;
  }

  const settings = JSON.parse(match[2]);
  return markdown.replace(pattern, settingsBlock(settings, match[1]));
}

function updatePluginSettings(vault, options, actions) {
  const pluginSettingsPath = path.join(
    vault,
    ".obsidian",
    "plugins",
    "obsidian-kanban",
    "data.json",
  );
  const current = readFileIfExists(pluginSettingsPath);

  if (current === null) {
    actions.push(
      `skip ${displayPath(pluginSettingsPath)}; Obsidian Kanban plugin settings file does not exist`,
    );
    return;
  }

  const settings = applyKanbanSettings(JSON.parse(current));
  writeIfChanged(pluginSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, options, actions);
}

function bundledKanbanTemplate() {
  const template = readFileIfExists(bundledKanbanTemplatePath);
  if (template === null) {
    throw new Error(`Missing bundled Kanban template: ${bundledKanbanTemplatePath}`);
  }
  return template;
}

function templateInfo(markdown) {
  const lanes = extractLanes(markdown);
  const { settings } = extractSettings(markdown);
  return { lanes, settings };
}

function updateRepoKanbanTemplate(projectRoot, options, actions) {
  const templatePath = path.join(projectRoot, repoKanbanTemplatePath);
  const current = readFileIfExists(templatePath);

  if (current === null) {
    const template = bundledKanbanTemplate();
    writeIfChanged(templatePath, template, options, actions);
    return templateInfo(template);
  }

  const updated = updateMarkdownSettings(current);
  writeIfChanged(templatePath, updated, options, actions);
  return templateInfo(updated);
}

function checklist(items, { checked = false, indent = "" } = {}) {
  const checkChar = checked ? "x" : " ";
  return items.map((item) => `${indent}- [${checkChar}] ${item}`).join("\n");
}

function cardMarkdown({
  checked,
  id,
  title,
  description,
  planPath,
  tags,
  todos,
  acceptance,
  verification,
}) {
  const checkChar = checked ? "x" : " ";
  const tagLine = tags.map((tag) => `#${tag}`).join(" ");

  return `- [${checkChar}] # <span style="color: #77ccd5">${id} ${title}</span>

    ## Description

    ${tagLine}

    ${description}

    ## Implementation Details

    - Ticket: ${id}
    - Plan: ${planPath}

    ## TODO Checklist
    Items to implement:

${checklist(todos, { checked, indent: "    " })}

    ## Acceptance Criteria

${checklist(acceptance, { checked, indent: "    " })}

    ## Verification

    Checks to run:

${checklist(verification, { checked, indent: "    " })}`;
}

function bootstrapPlanMarkdown(context) {
  const id = context.bootstrapTicketId;

  return `# ${id} ${bootstrapTitle}

- Ticket: ${id}
- Board: ${boardReference()}
- Card: ${id} ${bootstrapTitle}
- Created: ${context.today}

## Summary

Set up repo-local agent instructions, Obsidian Kanban issue tracking, ticket numbering, stable repo plan files, and domain documentation conventions for this project.

## Context

This project uses an Obsidian Kanban board for visible ticket state and stores long-lived execution plans in stable Markdown files under \`docs/plans/\`.

## Plan

- [x] Create or update \`AGENTS.md\`
- [x] Create or update \`CLAUDE.md\`
- [x] Create \`docs/agents/*\`
- [x] Create \`docs/agents/project-workflow.json\`
- [x] Create \`docs/agents/ticket-sequence.json\`
- [x] Create \`docs/plans/\`
- [x] Create Obsidian Kanban board
- [x] Configure Kanban tag colors

## Verification

- [x] Board path mirrors the project path relative to home
- [x] Ticket sequence state is initialized
- [x] Bootstrap card links to this plan
- [x] Generated ticket workflow includes deterministic closeout rules
- [x] Triage tags are Obsidian tags
- [x] Kanban tag colors are present in board/template settings

## Outcome

Project workflow initialized.
`;
}

function boardMarkdown(context, templateInfo) {
  const lanes = lanesWithCompleted(templateInfo.lanes);
  const settings = {
    "kanban-plugin": "board",
    "list-collapse": lanes.map(() => false),
    "lane-width": 400,
    ...templateInfo.settings,
  };
  const planPath = `docs/plans/${ticketPlanFileName(context.bootstrapTicketId, bootstrapTitle)}`;
  const sections = lanes.map((lane) => {
    if (lane !== "Completed") return `## ${lane}\n`;

    return `## Completed

${cardMarkdown({
      checked: true,
      id: context.bootstrapTicketId,
      title: bootstrapTitle,
      description:
        "Set up repo-local agent instructions, Obsidian Kanban issue tracking, ticket numbering, stable repo plan files, and domain documentation conventions for this project.",
      planPath,
      tags: [bootstrapTriageTag, ...bootstrapTopicTags],
      todos: [
        "Create or update `AGENTS.md`",
        "Create repo-local docs under `docs/agents/`",
        "Create stable plan storage under `docs/plans/`",
        "Create the Obsidian Kanban board and repo-local template",
        "Configure canonical Kanban tag colors",
      ],
      acceptance: [
        "Repo-local agent instructions point agents to the Kanban board and linked plans",
        "Ticket sequence state is initialized without resetting existing tickets",
        "Bootstrap plan and Kanban card link to each other",
      ],
      verification: [
        "Board path mirrors the project path relative to home",
        "Generated ticket workflow includes deterministic closeout rules",
        "Kanban tag colors are present in board/template settings",
      ],
    })}
`;
  });

  return `---
kanban-plugin: board
---

${sections.join("\n\n")}


${settingsBlock(settings)}
`;
}

function upsertAgentSkillsBlock(markdown, block) {
  const normalizedBlock = `${block.trimEnd()}\n`;
  const heading = /^## Agent skills\s*$/m.exec(markdown);

  if (!heading) {
    return `${markdown.trimEnd()}\n\n${normalizedBlock}`;
  }

  const start = heading.index;
  const rest = markdown.slice(start + heading[0].length);
  const nextLevelTwoHeading = /\n##(?!#)\s+/.exec(rest);
  const end =
    nextLevelTwoHeading === null
      ? markdown.length
      : start + heading[0].length + nextLevelTwoHeading.index + 1;
  const prefix = markdown.slice(0, start).trimEnd();
  const suffix = markdown.slice(end).replace(/^\n+/, "");

  return `${prefix ? `${prefix}\n\n` : ""}${normalizedBlock}${
    suffix ? `\n${suffix}` : ""
  }`;
}

function agentSkillsBlock(context) {
  return `## Agent skills

### Issue tracker

Issues and implementation tickets live in the Obsidian Kanban board ${boardReference()}. External PRs are not a triage surface. See \`docs/agents/issue-tracker.md\`.

### Ticket workflow

Create tickets with \`new_project_ticket.mjs\`; it allocates stable IDs, appends a Kanban card, creates a linked plan in \`docs/plans/\`, and advances \`docs/agents/ticket-sequence.json\`. Use repeatable \`--todo\`, \`--acceptance\`, and \`--verification\` fields when a ticket is ready for agent implementation. Update ticket status with \`update_project_ticket.mjs\` after code changes and during closeout. See \`docs/agents/ticket-workflow.md\`.

When working from a ticket, read the Kanban card and linked plan before implementation. After making implementation changes, move the card to \`In Progress\` unless it is already there. Before calling the ticket complete, verify the acceptance criteria and verification items; add completion notes to the linked plan; move the Kanban card to \`Completed\`; check applicable TODO, Acceptance Criteria, and Verification boxes; and re-read the board to confirm the lane.

### Execution plans

Execution plan Markdown files live under stable paths in \`docs/plans/\`, for example \`docs/plans/${ticketPlanFileName(
    context.bootstrapTicketId,
    bootstrapTitle,
  )}\`. Do not use lane-named status folders for new plans; old \`docs/plans/Backlog/\`, \`docs/plans/In Progress/\`, and \`docs/plans/Completed/\` folders are legacy.

### Triage labels

Use the default five-role triage vocabulary as Obsidian tags configured with Kanban plugin colors: \`#needs-triage\`, \`#needs-info\`, \`#ready-for-agent\`, \`#ready-for-human\`, and \`#wontfix\`. Add, remove, or replace those tags in the card's \`Description\` section. See \`docs/agents/triage-labels.md\`.

### Domain docs

This is a single-context repo: read root \`CONTEXT.md\` and \`docs/adr/\` if they exist. See \`docs/agents/domain.md\`.
${context.codexAutoCompact.enabled ? codexAutoCompactAgentBlock() : ""}
`;
}

function codexAutoCompactAgentBlock() {
  return `
### Post-compaction recovery

This project opts into project-local Codex auto-compaction scaffolding. If the conversation was compacted, first read \`${codexAutoCompactPaths.latestHandoff}\` if it exists, then continue. Use it to restore the current goal, decisions, open TODOs, verification state, changed files, and blockers before doing new work. See \`docs/agents/codex-auto-compact.md\`.
`;
}

function updateAgentsFile(context, options, actions) {
  const agentsPath = path.join(context.projectRoot, "AGENTS.md");
  const current =
    readFileIfExists(agentsPath) ??
    "# Agent Instructions\n\nThis file is the source of truth for repo-local agent guidance. Keep shared instructions here; `CLAUDE.md` is only a thin wrapper that points Claude Code back to this file.\n";
  const updated = upsertAgentSkillsBlock(current, agentSkillsBlock(context));
  writeIfChanged(agentsPath, updated, options, actions);
}

function claudeWrapper() {
  return `# Claude Code Instructions

Read and follow \`AGENTS.md\`. It is the canonical source for repo-local agent guidance.

Do not duplicate shared instructions in this file. Update \`AGENTS.md\` instead.
`;
}

function isClaudeWrapper(markdown) {
  return (
    markdown.includes("AGENTS.md") &&
    markdown.includes("canonical source") &&
    markdown.includes("Do not duplicate")
  );
}

function updateClaudeFile(context, options, actions) {
  const claudePath = path.join(context.projectRoot, "CLAUDE.md");
  const current = readFileIfExists(claudePath);

  if (current !== null && current !== claudeWrapper() && !isClaudeWrapper(current) && !options.force) {
    actions.push(
      `skip existing ${displayPath(claudePath)}; merge shared guidance into AGENTS.md, then rerun with --force`,
    );
    return;
  }

  writeIfChanged(claudePath, claudeWrapper(), options, actions);
}

function projectWorkflowConfig(context) {
  return {
    provider: "obsidian-kanban",
    vaultEnvVar,
    boardPathStrategy: "home-relative-project-path",
    kanbanTemplatePath: repoKanbanTemplatePath,
    planDir: "docs/plans",
    ticketSequencePath: "docs/agents/ticket-sequence.json",
    codexAutoCompact: context.codexAutoCompact,
  };
}

function ticketSequence(context, next = 2) {
  return {
    prefix: context.ticketPrefix,
    next,
    width: ticketWidth,
  };
}

function existingProjectWorkflowConfig(projectRoot) {
  const workflowPath = path.join(projectRoot, "docs", "agents", "project-workflow.json");
  const content = readFileIfExists(workflowPath);
  if (content === null) return {};

  try {
    return JSON.parse(content);
  } catch {
    return {};
  }
}

function resolveCodexAutoCompactConfig(projectRoot, options) {
  const existing = existingProjectWorkflowConfig(projectRoot).codexAutoCompact ?? {};
  const enabled =
    options.codexAutoCompactEnabled ?? Boolean(existing.enabled);
  const contextWindowTokens =
    options.codexContextWindowTokens ??
    existing.contextWindowTokens ??
    codexAutoCompactDefaults.contextWindowTokens;
  const thresholdPercent =
    options.codexAutoCompactThresholdPercent ??
    existing.thresholdPercent ??
    codexAutoCompactDefaults.thresholdPercent;

  if (!Number.isInteger(contextWindowTokens) || contextWindowTokens <= 0) {
    throw new Error(
      `Invalid existing codexAutoCompact.contextWindowTokens ${contextWindowTokens}. Expected a positive integer.`,
    );
  }

  if (!Number.isFinite(thresholdPercent) || thresholdPercent <= 0 || thresholdPercent >= 60) {
    throw new Error(
      `Invalid existing codexAutoCompact.thresholdPercent ${thresholdPercent}. Expected a number greater than 0 and below 60.`,
    );
  }

  return {
    enabled,
    contextWindowTokens,
    thresholdPercent,
    tokenLimit: Math.floor((contextWindowTokens * thresholdPercent) / 100),
    configPath: codexAutoCompactPaths.config,
    compactPromptPath: codexAutoCompactPaths.prompt,
    handoffHookPath: codexAutoCompactPaths.hook,
    latestHandoffPath: codexAutoCompactPaths.latestHandoff,
    caveat:
      "Codex PreCompact matchers distinguish manual vs auto compaction, not main-agent vs subagent sessions.",
  };
}

function issueTrackerDoc(context) {
  return `# Issue Tracker: Obsidian Kanban

Issues, implementation tickets, and project task state for this repo live in an Obsidian Kanban board.

## Board

- Vault env var: \`${vaultEnvVar}\`
- Board path strategy: derive from the vault root and this repository's path relative to \`$HOME\`
- Board filename strategy: project title plus \` Kanban.md\`
- Kanban template path: \`${repoKanbanTemplatePath}\`
- Local env file: \`.env\` (ignored)
- Env example: \`.env.example\`
- Tool config: \`docs/agents/project-workflow.json\`
- Ticket sequence: \`docs/agents/ticket-sequence.json\`
- Execution plans: \`docs/plans/*.md\`

The board path mirrors the project path relative to the home directory. Keep the vault root in \`.env\`, not in committed docs.

## Lanes

- \`Backlog\` means not started.
- \`In Progress\` means actively being worked.
- \`Completed\` means done.

The current ticket status is the card's lane on the Obsidian board. Do not encode current status in the plan file path.

## Ticket Format

When a skill says "publish to the issue tracker", use the ticket utility documented in \`docs/agents/ticket-workflow.md\`. It creates the Kanban card and linked plan file together.

Each ticket card should stay short and include:

- title line using the Kanban checkbox/card format, with the stable ticket ID first
- \`## Description\` with all tags and a 1-3 sentence summary
- \`## Implementation Details\` with \`Ticket\` and \`Plan\` bullets
- \`## TODO Checklist\`
- \`## Acceptance Criteria\`
- \`## Verification\`

Use this shape:

\`\`\`markdown
- [ ] # <span style="color: #77ccd5">${context.ticketPrefix}-0002 Ticket title</span>

    ## Description

    #needs-triage #optional-topic

    1-3 sentence summary.

    ## Implementation Details

    - Ticket: ${context.ticketPrefix}-0002
    - Plan: docs/plans/${context.ticketPrefix}-0002-ticket-title.md

    ## TODO Checklist
    Items to implement:

    - [ ] First ticket-specific implementation step

    ## Acceptance Criteria

    - [ ] Observable ticket-specific result required for completion

    ## Verification

    Checks to run:

    - [ ] Ticket-specific command or review check
\`\`\`

For implementation work, record longform context, plans, and completion notes in the linked \`docs/plans/*.md\` file. Keep the card scannable. A \`#ready-for-agent\` card must have ticket-specific TODO, Acceptance Criteria, and Verification items.

## Fetching Tickets

When a skill says "fetch the relevant ticket", read the referenced card in the Obsidian Kanban board and then read its linked plan file under \`docs/plans/\`. Use the card and plan as the source of truth for scope, TODOs, acceptance criteria, constraints, and verification.

## Pull Requests

External PRs are not currently treated as a request surface for this project. Track requested work in the Obsidian Kanban board unless the user explicitly says otherwise.
`;
}

function ticketWorkflowDoc(context) {
  return `# Ticket Workflow

How agents create and maintain project tickets.

## Source Of Truth

- Visible ticket state lives in the Obsidian Kanban board.
- Current status is the card's lane on the board.
- Longform execution context lives in stable Markdown files under \`docs/plans/\`.
- Ticket numbering state lives in committed repo file \`docs/agents/ticket-sequence.json\`.
- Tool-readable workflow config lives in \`docs/agents/project-workflow.json\`.
- Local vault root lives in ignored \`.env\` as \`${vaultEnvVar}\`.

Lane-named plan folders such as \`docs/plans/Backlog/\`, \`docs/plans/In Progress/\`, and \`docs/plans/Completed/\` are legacy. Do not create new plan files there.

## Creating Tickets

Use the bundled utility from the repo root:

\`\`\`bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/new_project_ticket.mjs" \\
  --title "Ticket title" \\
  --description "Short 1-3 sentence summary." \\
  --todo "First implementation step." \\
  --acceptance "Observable result required for completion." \\
  --verification "Command or review step that proves completion." \\
  --tag optional-topic
\`\`\`

Only \`--title\` is required. Defaults:

- \`--project-root\`: current directory
- \`--lane\`: \`Backlog\`
- \`--triage\`: \`needs-triage\`
- \`--description\`: placeholder summary for the agent to replace
- \`--todo\`, \`--acceptance\`, \`--verification\`: explicit placeholders for the agent to replace

\`--triage ready-for-agent\` requires \`--description\` plus at least one \`--todo\`, \`--acceptance\`, and \`--verification\` field. Leave incomplete tickets as \`#needs-triage\`.

The utility:

- reconciles \`docs/agents/ticket-sequence.json\` against existing board cards and \`docs/plans/\`
- blocks exact duplicate titles unless \`--allow-duplicate\` is passed
- allocates the next \`${context.ticketPrefix}-0000\` style ID
- appends the new card to the bottom of the target lane with ticket-specific checklist sections
- creates the linked plan file under \`docs/plans/\` with the same TODO, acceptance, and verification items
- advances \`docs/agents/ticket-sequence.json\`

## Updating Ticket Status

Use the status utility whenever implementation state changes:

\`\`\`bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/update_project_ticket.mjs" \\
  --ticket "${context.ticketPrefix}-0002" \\
  --lane "In Progress" \\
  --note "Started implementation after updating code."
\`\`\`

Rules:

- After changing implementation code for a ticket, move the card to \`In Progress\` unless it is already there.
- If acceptance criteria are complete, move the card to \`Completed\` with \`--complete\`.
- Status lives in the board lane, not in the linked plan filename or a plan \`Status\` field.
- The utility appends progress or completion notes to the linked plan when \`--note\` is provided.

## Tags

All tags live in the card's \`Description\` section.

The utility adds one triage tag by default: \`#needs-triage\`. Agents may replace it with exactly one of:

- \`#needs-triage\`
- \`#needs-info\`
- \`#ready-for-agent\`
- \`#ready-for-human\`
- \`#wontfix\`

Topic tags can be added with repeatable \`--tag\` flags or edited directly on the card.

## Working Tickets

Before implementing a ticket:

1. Read the Kanban card from the board.
2. Read the linked plan under \`docs/plans/\`.
3. Identify the requested goal, constraints, TODO checklist, acceptance criteria, and verification commands.
4. If the card and plan conflict, stop and ask the user which source to update.

After changing code for a ticket, run \`update_project_ticket.mjs --ticket <id> --lane "In Progress"\` before continuing unless the ticket is already complete.

## Completing Tickets

A ticket is not complete until tracker closeout is done. Before saying the work is complete:

1. Verify every acceptance criterion and verification item, or explicitly record why an item is not applicable.
2. Add completion notes to the linked plan with implementation summary, commits, verification commands, and results.
3. Run \`update_project_ticket.mjs --ticket <id> --lane "Completed" --complete --note "<summary>"\`.
4. Check applicable TODO, Acceptance Criteria, and Verification boxes on the card.
5. Add concise commit and verification bullets to the card's \`Implementation Details\` when useful.
6. Re-read the board and confirm the card is in \`Completed\` before the final response.

If closeout is blocked by filesystem permissions, missing board access, or unresolved acceptance criteria, do not call the ticket complete. Report the blocker and leave the card out of \`Completed\`.

## Plan Files

Plan files are long-lived project history. Keep them after completion.

Plan files should not contain a \`Status\` field. Use the card's lane on the board for current status.
`;
}

function triageLabelsDoc() {
  const rows = triageTags
    .map(
      (tag) =>
        `| \`${tag.role}\` | \`#${tag.tag}\` | ${tag.colorName} | ${tag.meaning} |`,
    )
    .join("\n");

  return `# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the strings used in this repo's issue tracker.

| Skill role | Obsidian tag | Kanban color | Meaning |
| --- | --- | --- | --- |
${rows}

When a skill mentions a role, use the corresponding Obsidian tag from this table. In the Obsidian Kanban board, record tags in the ticket's \`Description\` section.

## Kanban Tag Lines

Use these exact tags:

\`\`\`markdown
#needs-triage
#needs-info
#ready-for-agent
#ready-for-human
#wontfix
\`\`\`

The colors are configured in the Obsidian Kanban plugin's vault-level \`tag-colors\` setting and in board-local Kanban settings, so these tags render consistently across Kanban boards in the vault.
`;
}

function domainDoc() {
  return `# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This is a single-context repo.

## Before Exploring, Read These

- \`CONTEXT.md\` at the repo root, if it exists.
- \`docs/adr/\`, if it exists.

If these files do not exist, proceed silently. Do not flag their absence or create them upfront. The domain-modeling workflows can create them later when terms or decisions are actually resolved.

## File Structure

Expected single-context layout:

\`\`\`text
/
|-- CONTEXT.md
|-- docs/adr/
|   |-- 0001-example-decision.md
|   \`-- 0002-example-decision.md
\`-- src/
\`\`\`

## Use The Project Vocabulary

When output names a domain concept in an issue title, refactor proposal, hypothesis, or test name, use the term as defined in \`CONTEXT.md\` when that file exists.

If the concept you need is not in the glossary yet, either avoid inventing new language or note the gap for a future domain-modeling pass.

## Flag ADR Conflicts

If output contradicts an existing ADR, surface it explicitly instead of silently overriding it.
`;
}

function codexAutoCompactDoc(context) {
  const state = context.codexAutoCompact.enabled ? "enabled" : "disabled";

  return `# Codex Auto-Compaction

Project-local Codex auto-compaction setup is currently **${state}**.

## Current Config

- Enabled: \`${context.codexAutoCompact.enabled}\`
- Assumed context window: \`${context.codexAutoCompact.contextWindowTokens}\` tokens
- Auto-compact threshold: \`${context.codexAutoCompact.thresholdPercent}%\`
- Codex token limit: \`${context.codexAutoCompact.tokenLimit}\` tokens
- Project config: \`${codexAutoCompactPaths.config}\`
- Compact prompt: \`${codexAutoCompactPaths.prompt}\`
- Pre-compact hook: \`${codexAutoCompactPaths.hook}\`
- Latest handoff: \`${codexAutoCompactPaths.latestHandoff}\`

Codex currently accepts \`model_auto_compact_token_limit\` as an absolute token count, not a percentage. This setup computes that token count from the context window and threshold percentage, and requires the threshold to stay below 60%.

## Project-local Setup

Enable the scaffold from the project root:

\`\`\`bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/setup_project_workflow.mjs" \\
  --project-root "$PWD" \\
  --enable-codex-auto-compact
\`\`\`

Change the assumed context window or threshold:

\`\`\`bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/setup_project_workflow.mjs" \\
  --project-root "$PWD" \\
  --enable-codex-auto-compact \\
  --codex-context-window 128000 \\
  --codex-auto-compact-threshold-percent 55
\`\`\`

Disable the managed project config block:

\`\`\`bash
node "$HOME/.agents/skills/setup-project-workflow/scripts/setup_project_workflow.mjs" \\
  --project-root "$PWD" \\
  --disable-codex-auto-compact
\`\`\`

Project-local \`.codex/config.toml\` only loads when Codex trusts the project.

## What The Scaffold Does

When enabled, setup writes a managed block to \`${codexAutoCompactPaths.config}\` with:

- \`model_auto_compact_token_limit\`, set to the computed token limit
- \`experimental_compact_prompt_file\`, pointed at \`${codexAutoCompactPaths.prompt}\`
- a \`PreCompact\` hook matching \`auto\`, pointed at \`${codexAutoCompactPaths.hook}\`

The hook writes a lightweight repo-state handoff before auto-compaction. After compaction, the compact prompt tells the agent to read \`${codexAutoCompactPaths.latestHandoff}\` before continuing.

## Known Limitations

- Codex \`PreCompact\` matchers can distinguish \`manual\` and \`auto\`, but not main-agent versus subagent sessions.
- The generated hook records repo state; it cannot be assumed to have a full conversation transcript.
- If strict main-agent-only behavior is required, use a personal Codex profile for main sessions and custom subagent configs with different compaction settings, then validate any runtime metadata guards before relying on them.

## Personal Main-agent Profile

For a personal main-agent setup, keep the low threshold in a user-level profile instead of global \`~/.codex/config.toml\`:

\`\`\`toml
# ~/.codex/main-handoff.config.toml
model_auto_compact_token_limit = ${context.codexAutoCompact.tokenLimit}
experimental_compact_prompt_file = "/absolute/path/to/main-compact-prompt.md"
\`\`\`

Start main sessions with:

\`\`\`bash
codex --profile main-handoff
\`\`\`
`;
}

function codexCompactPrompt() {
  return `# Post-compaction Recovery

Before doing any new work after compaction:

1. Read \`${codexAutoCompactPaths.latestHandoff}\` if it exists.
2. Restore the current goal, decisions, open TODOs, verification state, changed files, and blockers.
3. If the handoff is missing or stale, say so and reconstruct state from the repository before continuing.
`;
}

function codexCompactionHookScript() {
  return `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 10000,
  });

  if (result.error) {
    return { ok: false, output: result.error.message };
  }

  const output = [result.stdout, result.stderr].filter(Boolean).join("\\n").trim();
  return { ok: result.status === 0, output };
}

function fenced(value) {
  return \`\\\`\\\`\\n\${value || "(none)"}\\n\\\`\\\`\`;
}

function listRecentPlans(projectRoot) {
  const planDir = path.join(projectRoot, "docs", "plans");
  if (!fs.existsSync(planDir)) return [];

  return fs
    .readdirSync(planDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const filePath = path.join(planDir, entry.name);
      return {
        name: path.relative(projectRoot, filePath),
        mtimeMs: fs.statSync(filePath).mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs)
    .slice(0, 10)
    .map((entry) => \`- \${entry.name}\`);
}

const startedCwd = process.cwd();
const gitRoot = run("git", ["rev-parse", "--show-toplevel"], startedCwd);
const projectRoot = gitRoot.ok && gitRoot.output ? gitRoot.output.split(/\\r?\\n/)[0] : startedCwd;
const handoffDir = path.join(projectRoot, ".codex", "handoffs");
const generatedAt = new Date().toISOString();
const stamp = generatedAt.replace(/[:.]/g, "-");
const latestPath = path.join(handoffDir, "latest.md");
const stampedPath = path.join(handoffDir, \`\${stamp}.md\`);
const status = run("git", ["status", "--short", "--branch"], projectRoot);
const diffStat = run("git", ["diff", "--stat"], projectRoot);
const changedFiles = run("git", ["diff", "--name-only"], projectRoot);
const recentPlans = listRecentPlans(projectRoot);

const markdown = \`# Codex Auto-Compaction Handoff

- Generated: \${generatedAt}
- Trigger: PreCompact auto hook
- Project root: \${projectRoot}
- Session cwd: \${startedCwd}

## Recovery Checklist

- [ ] Restore the current user goal.
- [ ] Restore important decisions and constraints.
- [ ] Restore open TODOs and blockers.
- [ ] Restore verification state and commands still needed.
- [ ] Inspect changed files before continuing implementation.

## Repo Snapshot

### Git Status

\${fenced(status.ok ? status.output : \`Git status unavailable: \${status.output}\`)}

### Diff Stat

\${fenced(diffStat.ok ? diffStat.output : \`Git diff stat unavailable: \${diffStat.output}\`)}

### Changed Files

\${fenced(changedFiles.ok ? changedFiles.output : \`Changed files unavailable: \${changedFiles.output}\`)}

### Recent Plan Files

\${recentPlans.length > 0 ? recentPlans.join("\\n") : "- No docs/plans/*.md files found."}

## Caveat

This hook records repository state only. It does not guarantee access to the full conversation transcript, so the agent should combine this handoff with the compacted conversation summary.
\`;

fs.mkdirSync(handoffDir, { recursive: true });
fs.writeFileSync(stampedPath, markdown);
fs.writeFileSync(latestPath, markdown);
console.log(\`Wrote Codex handoff: \${path.relative(projectRoot, latestPath)}\`);
`;
}

function codexAutoCompactToml(context) {
  return `${codexAutoCompactBlockStart}
model_auto_compact_token_limit = ${context.codexAutoCompact.tokenLimit}
experimental_compact_prompt_file = "compact-prompt.md"

[[hooks.PreCompact]]
matcher = "auto"

[[hooks.PreCompact.hooks]]
type = "command"
command = 'node "$(git rev-parse --show-toplevel)/${codexAutoCompactPaths.hook}"'
timeout = 60
statusMessage = "Writing Codex handoff before auto-compaction"
${codexAutoCompactBlockEnd}`;
}

function removeCodexAutoCompactBlock(content) {
  const start = content.indexOf(codexAutoCompactBlockStart);
  if (start === -1) return content;

  const end = content.indexOf(codexAutoCompactBlockEnd, start);
  if (end === -1) return content;

  const before = content.slice(0, start).trimEnd();
  const after = content.slice(end + codexAutoCompactBlockEnd.length).replace(/^\s+/, "");
  if (!before) return after ? `${after.trimStart()}` : "";
  return after ? `${before}\n\n${after}` : `${before}\n`;
}

function hasUnmanagedAutoCompactKeys(content) {
  const unmanaged = removeCodexAutoCompactBlock(content);
  return /^\s*(model_auto_compact_token_limit|experimental_compact_prompt_file)\s*=/m.test(unmanaged);
}

function updateCodexConfig(context, options, actions) {
  const configPath = path.join(context.projectRoot, codexAutoCompactPaths.config);
  const current = readFileIfExists(configPath) ?? "";
  const withoutManagedBlock = removeCodexAutoCompactBlock(current);

  if (!context.codexAutoCompact.enabled) {
    if (current === "") {
      actions.push(`skip ${displayPath(configPath)}; Codex auto-compaction disabled`);
      return;
    }

    writeIfChanged(configPath, withoutManagedBlock, options, actions);
    return;
  }

  if (hasUnmanagedAutoCompactKeys(current)) {
    actions.push(
      `skip ${displayPath(configPath)}; existing unmanaged Codex compaction keys need manual merge`,
    );
    return;
  }

  const base = withoutManagedBlock.trimEnd();
  const content = `${base ? `${base}\n\n` : ""}${codexAutoCompactToml(context)}\n`;
  writeIfChanged(configPath, content, options, actions);
}

function updateCodexAutoCompactArtifacts(context, options, actions) {
  updateCodexConfig(context, options, actions);

  if (!context.codexAutoCompact.enabled) return;

  writeGeneratedFile(
    path.join(context.projectRoot, codexAutoCompactPaths.prompt),
    codexCompactPrompt(),
    options,
    actions,
  );
  writeGeneratedFile(
    path.join(context.projectRoot, codexAutoCompactPaths.hook),
    codexCompactionHookScript(),
    options,
    actions,
  );
  updateGitignorePattern(context.projectRoot, ".codex/handoffs/", options, actions);
}

function updateDocs(context, options, actions) {
  const docsDir = path.join(context.projectRoot, "docs", "agents");
  writeGeneratedFile(path.join(docsDir, "issue-tracker.md"), issueTrackerDoc(context), options, actions);
  writeGeneratedFile(path.join(docsDir, "ticket-workflow.md"), ticketWorkflowDoc(context), options, actions);
  writeGeneratedFile(path.join(docsDir, "triage-labels.md"), triageLabelsDoc(), options, actions);
  writeGeneratedFile(path.join(docsDir, "domain.md"), domainDoc(), options, actions);
  writeIfChanged(
    path.join(docsDir, "codex-auto-compact.md"),
    codexAutoCompactDoc(context),
    options,
    actions,
  );
  writeIfChanged(
    path.join(docsDir, "project-workflow.json"),
    `${JSON.stringify(projectWorkflowConfig(context), null, 2)}\n`,
    options,
    actions,
  );
  writeStateFileIfMissing(
    path.join(docsDir, "ticket-sequence.json"),
    `${JSON.stringify(ticketSequence(context), null, 2)}\n`,
    options,
    actions,
  );
}

function updatePlanArtifacts(context, options, actions) {
  const planDir = path.join(context.projectRoot, "docs", "plans");
  ensureDir(planDir, options, actions);

  writeGeneratedFile(
    path.join(planDir, ticketPlanFileName(context.bootstrapTicketId, bootstrapTitle)),
    bootstrapPlanMarkdown(context),
    options,
    actions,
  );
}

function updateBoard(context, templateInfo, options, actions) {
  const current = readFileIfExists(context.boardPath);
  if (current === null) {
    writeIfChanged(context.boardPath, boardMarkdown(context, templateInfo), options, actions);
    return;
  }

  writeIfChanged(context.boardPath, updateMarkdownSettings(current), options, actions);
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const actions = [];
  ensureDir(options.projectRoot, options, actions);
  updateLocalConfigFiles(options.projectRoot, options, actions);

  const projectEnv = readProjectEnv(options.projectRoot);
  const vaultPath = resolveRequiredVault(options.projectRoot, projectEnv, options);
  const projectName = path.basename(options.projectRoot);
  const projectTitle = titleCase(projectName);
  const relativeProjectPath = projectRelativePath(options.projectRoot);
  const boardPath = path.join(vaultPath, relativeProjectPath, `${projectTitle} Kanban.md`);
  const ticketPrefix = options.ticketPrefix || defaultTicketPrefix(projectName);
  const today = new Date().toISOString().slice(0, 10);
  const codexAutoCompact = resolveCodexAutoCompactConfig(options.projectRoot, options);
  const context = {
    projectRoot: options.projectRoot,
    projectName,
    projectTitle,
    ticketPrefix,
    bootstrapTicketId: ticketId(ticketPrefix, bootstrapTicketNumber),
    relativeProjectPath,
    vault: vaultPath,
    boardPath,
    today,
    codexAutoCompact,
  };

  const templateInfo = updateRepoKanbanTemplate(options.projectRoot, options, actions);
  updatePluginSettings(vaultPath, options, actions);
  updateBoard(context, templateInfo, options, actions);
  updatePlanArtifacts(context, options, actions);
  updateCodexAutoCompactArtifacts(context, options, actions);
  updateAgentsFile(context, options, actions);
  updateClaudeFile(context, options, actions);
  updateDocs(context, options, actions);

  console.log(options.dryRun ? "Dry run complete:" : "Setup complete:");
  for (const action of actions) {
    console.log(`- ${action}`);
  }
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
