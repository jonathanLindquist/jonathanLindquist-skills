import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const homeDir = os.homedir();
const vaultEnvVar = "PROJECT_WORKFLOW_OBSIDIAN_VAULT";
const allowedLanes = new Set(["Backlog", "In Progress", "Completed"]);
const triageTags = new Set([
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
]);

const usage = `Usage:
  update_project_ticket.mjs --ticket <id> --lane <lane> [options]

Options:
  --project-root <path>  Repo/project root. Defaults to cwd.
  --ticket <id>          Required ticket ID, for example ABC-0002.
  --lane <name>          Required Kanban lane: Backlog, In Progress, or Completed.
  --triage <tag>         Optional triage tag without #.
  --note <text>          Optional progress or completion note for the linked plan.
  --complete             Shortcut for --lane Completed and checking card TODO/DoD/Verification boxes.
  --help                 Show this help.
`;

function parseArgs(argv) {
  const options = {
    projectRoot: process.cwd(),
    ticket: null,
    lane: null,
    triage: null,
    note: null,
    complete: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--project-root") {
      options.projectRoot = argv[++index];
    } else if (arg === "--ticket") {
      options.ticket = String(argv[++index] ?? "").trim();
    } else if (arg === "--lane") {
      options.lane = String(argv[++index] ?? "").trim();
    } else if (arg === "--triage") {
      options.triage = normalizeTag(argv[++index]);
    } else if (arg === "--note") {
      options.note = String(argv[++index] ?? "").trim();
    } else if (arg === "--complete") {
      options.complete = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(usage);
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}\n\n${usage}`);
    }
  }

  if (!options.ticket) {
    throw new Error(`Missing required --ticket.\n\n${usage}`);
  }

  if (options.complete && !options.lane) {
    options.lane = "Completed";
  }

  if (!options.lane) {
    throw new Error(`Missing required --lane.\n\n${usage}`);
  }

  if (!allowedLanes.has(options.lane)) {
    throw new Error(`Invalid --lane ${options.lane}. Expected one of: ${[...allowedLanes].join(", ")}`);
  }

  if (options.triage && !triageTags.has(options.triage)) {
    throw new Error(
      `Invalid --triage ${options.triage}. Expected one of: ${[...triageTags].join(", ")}`,
    );
  }

  if (options.complete && options.lane !== "Completed") {
    throw new Error("--complete requires --lane Completed.");
  }

  options.projectRoot = path.resolve(expandHome(options.projectRoot));
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

function normalizeTag(value) {
  return String(value ?? "")
    .trim()
    .replace(/^#/, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-|-$/g, "");
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

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function readJson(filePath) {
  return JSON.parse(readText(filePath));
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

  return path.resolve(expandHome(value.trim()));
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

function loadWorkflow(projectRoot) {
  const workflowPath = path.join(projectRoot, "docs", "agents", "project-workflow.json");
  if (!fs.existsSync(workflowPath)) {
    throw new Error(`Missing project workflow config: ${workflowPath}`);
  }

  const workflow = readJson(workflowPath);
  return {
    boardPath: deriveBoardPath(projectRoot, workflow),
    planDir: resolveRepoPath(projectRoot, workflow.planDir, "planDir"),
    sequencePath: resolveRepoPath(projectRoot, workflow.ticketSequencePath, "ticketSequencePath"),
  };
}

function isTopLevelCard(line) {
  return /^- \[[ xX]\]/.test(line);
}

function findCardRange(markdown, ticketId) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => isTopLevelCard(line) && line.includes(ticketId));

  if (start === -1) {
    throw new Error(`Ticket not found on board: ${ticketId}`);
  }

  let lane = null;
  for (let index = start - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/^##\s+(.+)$/);
    if (match) {
      lane = match[1].trim();
      break;
    }
  }

  if (!lane) {
    throw new Error(`Could not determine lane for ticket: ${ticketId}`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (lines[index].startsWith("## ") || trimmed.startsWith("%% kanban:settings") || isTopLevelCard(lines[index])) {
      end = index;
      break;
    }
  }

  return {
    lines,
    start,
    end,
    lane,
    cardLines: lines.slice(start, end),
  };
}

function insertCardAtBottomOfLane(markdown, lane, cardMarkdown) {
  const lines = markdown.split(/\r?\n/);
  const laneIndex = lines.findIndex((line) => line.trim() === `## ${lane}`);

  if (laneIndex === -1) {
    throw new Error(`Lane not found: ${lane}`);
  }

  let insertIndex = lines.length;
  for (let index = laneIndex + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index]) || lines[index].startsWith("%% kanban:settings")) {
      insertIndex = index;
      break;
    }
  }

  const before = lines.slice(0, insertIndex).join("\n").replace(/\s+$/u, "");
  const after = lines.slice(insertIndex).join("\n").replace(/^\s+/u, "");

  if (!after) return `${before}\n\n${cardMarkdown}\n`;
  return `${before}\n\n${cardMarkdown}\n\n${after}`;
}

function setCardChecked(cardLines, checked) {
  const check = checked ? "x" : " ";
  const updated = [...cardLines];
  updated[0] = updated[0].replace(/^- \[[ xX]\]/, `- [${check}]`);
  return updated;
}

function setAllNestedChecks(cardLines, checked) {
  const check = checked ? "x" : " ";
  return cardLines.map((line, index) => {
    if (index === 0) return line;
    return line.replace(/^(\s+- )\[[ xX]\]/, `$1[${check}]`);
  });
}

function setTriageTag(cardLines, triage) {
  if (!triage) return cardLines;

  return cardLines.map((line) => {
    const hasTriage = [...triageTags].some((tag) => line.includes(`#${tag}`));
    if (!hasTriage) return line;

    let updated = line;
    for (const tag of triageTags) {
      updated = updated.replace(new RegExp(`#${tag}\\b`, "g"), "");
    }
    return updated.replace(/\s+$/u, "").concat(` #${triage}`);
  });
}

function extractPlanPath(projectRoot, cardLines) {
  const planLine = cardLines.find((line) => /^\s+- Plan:\s+/.test(line));
  if (!planLine) return null;

  const value = planLine.replace(/^\s+- Plan:\s+/, "").trim();
  return resolveRepoPath(projectRoot, value, "card Plan");
}

function replaceCard(markdown, range, cardLines) {
  const lines = markdown.split(/\r?\n/);
  return [...lines.slice(0, range.start), ...cardLines, ...lines.slice(range.end)].join("\n");
}

function removeCard(markdown, range) {
  const lines = markdown.split(/\r?\n/);
  return [...lines.slice(0, range.start), ...lines.slice(range.end)].join("\n");
}

function moveCard(markdown, ticketId, targetLane, cardLines) {
  const range = findCardRange(markdown, ticketId);

  if (range.lane === targetLane) {
    return {
      markdown: replaceCard(markdown, range, cardLines),
      previousLane: range.lane,
      changedLane: false,
    };
  }

  const withoutCard = removeCard(markdown, range);
  return {
    markdown: insertCardAtBottomOfLane(withoutCard, targetLane, cardLines.join("\n")),
    previousLane: range.lane,
    changedLane: true,
  };
}

function appendPlanNote(planPath, lane, note) {
  if (!note) return false;

  const heading = lane === "Completed" ? "## Completion Notes" : "## Progress Notes";
  const today = new Date().toISOString().slice(0, 10);
  const line = `- ${today}: ${note}`;
  const current = fs.existsSync(planPath) ? readText(planPath) : "";

  if (current.includes(line)) {
    return false;
  }

  if (current.includes(heading)) {
    writeText(planPath, current.replace(heading, `${heading}\n\n${line}`));
    return true;
  }

  const separator = current.trimEnd() ? "\n\n" : "";
  writeText(planPath, `${current.trimEnd()}${separator}${heading}\n\n${line}\n`);
  return true;
}

function updateTicket(options, workflow) {
  const board = readText(workflow.boardPath);
  const range = findCardRange(board, options.ticket);
  const planPath = extractPlanPath(options.projectRoot, range.cardLines);
  let cardLines = setCardChecked(range.cardLines, options.lane === "Completed");

  if (options.complete || options.lane === "Completed") {
    cardLines = setAllNestedChecks(cardLines, true);
  }

  cardLines = setTriageTag(cardLines, options.triage);

  const moved = moveCard(board, options.ticket, options.lane, cardLines);
  writeText(workflow.boardPath, moved.markdown);

  const planNoteChanged = planPath ? appendPlanNote(planPath, options.lane, options.note) : false;

  return {
    previousLane: moved.previousLane,
    currentLane: options.lane,
    changedLane: moved.changedLane,
    boardPath: workflow.boardPath,
    planPath,
    planNoteChanged,
  };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const workflow = loadWorkflow(options.projectRoot);
  const result = updateTicket(options, workflow);

  console.log(`Updated ${options.ticket}`);
  console.log(`- Previous lane: ${result.previousLane}`);
  console.log(`- Current lane: ${result.currentLane}`);
  console.log(`- Lane changed: ${result.changedLane ? "yes" : "no"}`);
  console.log(`- Board: ${displayPath(result.boardPath)}`);
  if (result.planPath) {
    console.log(`- Plan: ${displayPath(result.planPath)}`);
    console.log(`- Plan note changed: ${result.planNoteChanged ? "yes" : "no"}`);
  }
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
