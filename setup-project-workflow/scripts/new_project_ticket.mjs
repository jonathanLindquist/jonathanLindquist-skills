import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const homeDir = os.homedir();
const vaultEnvVar = "PROJECT_WORKFLOW_OBSIDIAN_VAULT";
const defaultLane = "Backlog";
const defaultTriage = "needs-triage";
const triageTags = new Set([
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
]);

const usage = `Usage:
  new_project_ticket.mjs --title <title> [options]

Options:
  --project-root <path>  Repo/project root. Defaults to cwd.
  --title <title>        Required ticket title.
  --description <text>   1-3 sentence summary.
  --lane <name>          Kanban lane. Defaults to Backlog.
  --triage <tag>         Triage tag without #. Defaults to needs-triage.
  --tag <tag>            Optional topic tag without #. Repeatable.
  --allow-duplicate      Allow exact duplicate normalized titles.
  --help                 Show this help.
`;

function parseArgs(argv) {
  const options = {
    projectRoot: process.cwd(),
    title: null,
    description: null,
    lane: defaultLane,
    triage: defaultTriage,
    tags: [],
    allowDuplicate: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--project-root") {
      options.projectRoot = argv[++index];
    } else if (arg === "--title") {
      options.title = argv[++index];
    } else if (arg === "--description") {
      options.description = argv[++index];
    } else if (arg === "--lane") {
      options.lane = argv[++index];
    } else if (arg === "--triage") {
      options.triage = normalizeTag(argv[++index]);
    } else if (arg === "--tag") {
      options.tags.push(normalizeTag(argv[++index]));
    } else if (arg === "--allow-duplicate") {
      options.allowDuplicate = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage}`);
    }
  }

  if (!options.title || !options.title.trim()) {
    throw new Error(`Missing required --title.\n\n${usage}`);
  }

  options.title = options.title.trim();
  options.description =
    options.description?.trim() || "TODO: replace with a 1-3 sentence summary.";
  options.projectRoot = path.resolve(expandHome(options.projectRoot));
  options.lane = options.lane.trim();

  if (!triageTags.has(options.triage)) {
    throw new Error(
      `Invalid --triage ${options.triage}. Expected one of: ${[...triageTags].join(", ")}`,
    );
  }

  return options;
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
  if (!fs.existsSync(envPath)) return new Map();
  return parseEnv(readText(envPath));
}

function projectRelativePath(projectRoot) {
  const relative = path.relative(homeDir, projectRoot);

  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative;
  }

  return path.join("external-projects", path.basename(projectRoot));
}

function titleCase(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveRepoPath(projectRoot, value, fieldName) {
  if (!value || typeof value !== "string") {
    throw new Error(`Missing ${fieldName} in docs/agents/project-workflow.json.`);
  }

  const expanded = expandHome(value);
  if (path.isAbsolute(expanded)) {
    throw new Error(`${fieldName} must be relative to the project root, not an absolute path.`);
  }

  const resolved = path.resolve(projectRoot, expanded);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${fieldName} must stay inside the project root.`);
  }

  return resolved;
}

function resolveVaultPath(projectRoot, workflow) {
  const projectEnv = readProjectEnv(projectRoot);
  const primaryEnvVar = workflow.vaultEnvVar || vaultEnvVar;
  const value = projectEnv.get(primaryEnvVar);

  if (!value || !value.trim()) {
    throw new Error(
      [
        `Missing required local config: ${primaryEnvVar}.`,
        `Create ${path.join(projectRoot, ".env")} from .env.example and set ${primaryEnvVar} to your Obsidian vault root.`,
      ].join("\n"),
    );
  }

  return path.resolve(expandHome(value));
}

function deriveBoardPath(projectRoot, workflow) {
  if (workflow.boardPath) {
    throw new Error(
      "Legacy boardPath is no longer supported in docs/agents/project-workflow.json. Re-run setup_project_workflow.mjs after configuring .env.",
    );
  }

  const strategy = workflow.boardPathStrategy || "home-relative-project-path";
  if (strategy !== "home-relative-project-path") {
    throw new Error(`Unsupported boardPathStrategy: ${strategy}`);
  }

  const vaultPath = resolveVaultPath(projectRoot, workflow);
  const projectName = path.basename(projectRoot);
  return path.join(vaultPath, projectRelativePath(projectRoot), `${titleCase(projectName)} Kanban.md`);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function normalizeTag(value) {
  return String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function ticketId(prefix, number, width) {
  return `${prefix}-${String(number).padStart(width, "0")}`;
}

function ticketRegex(prefix) {
  return new RegExp(`${escapeRegExp(prefix)}-(\\d+)`, "g");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectPlanFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectPlanFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function highestTicketNumber(prefix, boardMarkdown, planDir) {
  const pattern = ticketRegex(prefix);
  let highest = 0;

  for (const source of [boardMarkdown, ...collectPlanFiles(planDir).map((file) => path.basename(file))]) {
    for (const match of source.matchAll(pattern)) {
      highest = Math.max(highest, Number(match[1]));
    }
  }

  return highest;
}

function extractCardTitles(boardMarkdown, prefix) {
  const lines = boardMarkdown.split(/\r?\n/);
  const titles = [];

  for (const line of lines) {
    if (!/^\s*-\s+\[[ xX]\]/.test(line)) continue;

    const span = line.match(/<span[^>]*>(.*?)<\/span>/);
    const rawTitle = span ? span[1] : line.replace(/^\s*-\s+\[[ xX]\]\s+#?\s*/, "");
    const idMatch = rawTitle.match(new RegExp(`^(${escapeRegExp(prefix)}-\\d+)\\s+(.+)$`));
    titles.push({
      id: idMatch ? idMatch[1] : null,
      title: idMatch ? idMatch[2].trim() : rawTitle.trim(),
      rawTitle: rawTitle.trim(),
    });
  }

  return titles;
}

function normalizeTitle(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function nearDuplicateTitles(existingTitles, title) {
  const wantedWords = new Set(normalizeTitle(title).split(" ").filter(Boolean));
  if (wantedWords.size === 0) return [];

  return existingTitles.filter((existing) => {
    const words = new Set(normalizeTitle(existing.title).split(" ").filter(Boolean));
    if (words.size === 0) return false;
    let overlap = 0;
    for (const word of wantedWords) {
      if (words.has(word)) overlap += 1;
    }
    const score = overlap / Math.max(wantedWords.size, words.size);
    return score >= 0.75 && normalizeTitle(existing.title) !== normalizeTitle(title);
  });
}

function cardMarkdown({ id, title, description, planPath, tags }) {
  const tagLine = tags.map((tag) => `#${tag}`).join(" ");

  return `- [ ] # <span style="color: #77ccd5">${id} ${title}</span>
    
    ## Description
    
    ${tagLine}
    
    ${description}
    
    ## Implementation Details
    
    - Ticket: ${id}
    - Plan: ${planPath}
    
    ## TODO Checklist
    Items to implement:
    
    - [ ] Read this card and the linked plan before implementation
    - [ ] Fill in linked plan with scope and acceptance criteria
    
    ## Definition of Done
    
    All checks are completed and the verification steps below pass:
    
    - [ ] Acceptance criteria or Definition of Done verified
    - [ ] Linked plan has completion notes with commits and verification results
    - [ ] Required checks pass
    - [ ] Card moved to Completed and board state verified`;
}

function planMarkdown({ id, title, description }) {
  const today = new Date().toISOString().slice(0, 10);

  return `# ${id} ${title}

- Ticket: ${id}
- Board: derived from \`$${vaultEnvVar}\` and \`docs/agents/project-workflow.json\`
- Card: ${id} ${title}
- Created: ${today}

## Summary

${description}

## Context

Relevant background, links, constraints, prior decisions, and source references.

## Plan

- [ ] First implementation step

## Acceptance Criteria

- [ ] Observable result or behavior required for completion.

## Verification

Commands, checks, or review steps required.

## Outcome

Fill in when completed with implementation summary, commits, verification commands, and results. Move the Kanban card to Completed only after this is filled in and the Definition of Done is checked.
`;
}

function insertCardAtBottomOfLane(boardMarkdown, lane, card) {
  const lines = boardMarkdown.split(/\r?\n/);
  const laneIndex = lines.findIndex((line) => line.trim() === `## ${lane}`);

  if (laneIndex === -1) {
    throw new Error(`Lane not found: ${lane}`);
  }

  let insertIndex = lines.length;
  for (let index = laneIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed.startsWith("## ") || trimmed.startsWith("%% kanban:settings")) {
      insertIndex = index;
      break;
    }
  }

  const before = lines.slice(0, insertIndex).join("\n").replace(/\s+$/u, "");
  const after = lines.slice(insertIndex).join("\n").replace(/^\s+/u, "");

  if (!after) return `${before}\n\n${card}\n`;
  return `${before}\n\n${card}\n\n${after}`;
}

function loadWorkflow(projectRoot) {
  const workflowPath = path.join(projectRoot, "docs", "agents", "project-workflow.json");
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Missing project workflow config: ${workflowPath}`);
  }

  const workflow = readJson(workflowPath);
  const sequencePath = resolveRepoPath(
    projectRoot,
    workflow.ticketSequencePath,
    "ticketSequencePath",
  );
  const planDir = resolveRepoPath(projectRoot, workflow.planDir, "planDir");
  const boardPath = deriveBoardPath(projectRoot, workflow);

  return {
    workflowPath,
    sequencePath,
    planDir,
    boardPath,
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const workflow = loadWorkflow(options.projectRoot);
  const sequenceRaw = readText(workflow.sequencePath);
  const sequence = JSON.parse(sequenceRaw);
  const board = readText(workflow.boardPath);
  const existingTitles = extractCardTitles(board, sequence.prefix);
  const exactDuplicate = existingTitles.find(
    (existing) => normalizeTitle(existing.title) === normalizeTitle(options.title),
  );

  if (exactDuplicate && !options.allowDuplicate) {
    throw new Error(
      `Duplicate ticket title: ${exactDuplicate.id ?? "(untracked)"} ${exactDuplicate.title}\nRerun with --allow-duplicate if this is intentional.`,
    );
  }

  const nearDuplicates = nearDuplicateTitles(existingTitles, options.title);
  const highest = highestTicketNumber(sequence.prefix, board, workflow.planDir);
  const number = Math.max(Number(sequence.next), highest + 1);
  const id = ticketId(sequence.prefix, number, sequence.width);
  const planPath = path.join(workflow.planDir, `${id}-${slugify(options.title)}.md`);
  const relativePlanPath = path.relative(options.projectRoot, planPath);

  if (fs.existsSync(planPath)) {
    throw new Error(`Plan already exists: ${displayPath(planPath)}`);
  }

  if (readText(workflow.sequencePath) !== sequenceRaw) {
    throw new Error("Ticket sequence changed while creating ticket. Rerun the command.");
  }

  const tags = [...new Set([options.triage, ...options.tags].filter(Boolean))];
  const card = cardMarkdown({
    id,
    title: options.title,
    description: options.description,
    planPath: relativePlanPath,
    tags,
  });
  const updatedBoard = insertCardAtBottomOfLane(board, options.lane, card);

  writeText(workflow.boardPath, updatedBoard);
  writeText(
    planPath,
    planMarkdown({
      id,
      title: options.title,
      description: options.description,
    }),
  );
  writeText(
    workflow.sequencePath,
    `${JSON.stringify({ ...sequence, next: number + 1 }, null, 2)}\n`,
  );

  if (nearDuplicates.length > 0) {
    console.warn("Near duplicate titles:");
    for (const duplicate of nearDuplicates) {
      console.warn(`- ${duplicate.id ?? "(untracked)"} ${duplicate.title}`);
    }
  }

  console.log(`Created ${id}`);
  console.log(`- Board: ${displayPath(workflow.boardPath)}`);
  console.log(`- Lane: ${options.lane}`);
  console.log(`- Plan: ${displayPath(planPath)}`);
  console.log(`- Sequence next: ${number + 1}`);
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
