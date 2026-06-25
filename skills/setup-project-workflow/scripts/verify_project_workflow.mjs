import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const bundledKanbanTemplatePath = path.resolve(scriptDir, "..", "assets", "kanban-template.md");
const homeDir = os.homedir();
const vaultEnvVar = "PROJECT_WORKFLOW_OBSIDIAN_VAULT";
const repoKanbanTemplatePath = "docs/agents/kanban-template.md";
const pathPortabilityAnchor = "Never commit absolute local paths";
const expectedVerifyCommand =
  'node "$HOME/.agents/skills/setup-project-workflow/scripts/verify_project_workflow.mjs" --project-root "$PWD"';
const requiredLanes = ["Backlog", "In Progress", "Completed"];
const requiredTriageTags = [
  "needs-triage",
  "needs-info",
  "ready-for-agent",
  "ready-for-human",
  "wontfix",
];
const requiredAgentDocs = [
  "docs/agents/domain.md",
  "docs/agents/issue-tracker.md",
  "docs/agents/kanban-template.md",
  "docs/agents/project-workflow.json",
  "docs/agents/ticket-sequence.json",
  "docs/agents/ticket-workflow.md",
  "docs/agents/triage-labels.md",
];
const requiredGeneratedDocAnchors = [
  {
    relativePath: "docs/agents/issue-tracker.md",
    anchors: [
      "Verification command: `verify_project_workflow.mjs`",
      "## Workflow Verification",
      "## Path Portability",
      pathPortabilityAnchor,
      "docs/agents/kanban-template.md",
    ],
  },
  {
    relativePath: "docs/agents/ticket-workflow.md",
    anchors: [
      "Setup verification is performed by `verify_project_workflow.mjs`",
      "## Completing Tickets",
      "## Path Portability",
      pathPortabilityAnchor,
      "docs/plans/",
    ],
  },
  {
    relativePath: "docs/agents/triage-labels.md",
    anchors: [
      "| `ready-for-agent` | `#ready-for-agent` |",
      "## Kanban Tag Lines",
      "#wontfix",
    ],
  },
  {
    relativePath: "docs/agents/domain.md",
    anchors: [
      "## Before Exploring, Read These",
      "## Flag ADR Conflicts",
      "docs/adr/",
    ],
  },
];

const usage = `Usage:
  verify_project_workflow.mjs [options]

Options:
  --project-root <path>  Repo/project root to verify. Defaults to cwd.
  --help                 Show this help.
`;

function parseArgs(argv) {
  const options = {
    projectRoot: process.cwd(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--project-root") {
      options.projectRoot = argv[++index];
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

function expandHome(value) {
  if (value === "$HOME" || value === "${HOME}") return homeDir;
  if (value === "~") return homeDir;
  if (value.startsWith("$HOME/")) return path.join(homeDir, value.slice("$HOME/".length));
  if (value.startsWith("${HOME}/")) return path.join(homeDir, value.slice("${HOME}/".length));
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

function titleCase(value) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readFileIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
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

function readJson(filePath, errors) {
  const content = readFileIfExists(filePath);
  if (content === null) {
    errors.push(`missing ${displayPath(filePath)}`);
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    errors.push(`invalid JSON in ${displayPath(filePath)}: ${error.message}`);
    return null;
  }
}

function resolveRepoPath(projectRoot, value, fieldName, errors) {
  if (!value || typeof value !== "string") {
    errors.push(`missing ${fieldName} in docs/agents/project-workflow.json`);
    return null;
  }

  const expanded = expandHome(value);
  if (path.isAbsolute(expanded)) {
    errors.push(`${fieldName} must be relative to the project root, not an absolute path`);
    return null;
  }

  const resolved = path.resolve(projectRoot, expanded);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    errors.push(`${fieldName} must stay inside the project root`);
    return null;
  }

  return resolved;
}

function isInsideOrEqual(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function gitignoreIgnoresEnv(markdown) {
  return markdown.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed === ".env" || trimmed === ".env*";
  });
}

function gitignoreIgnoresSast(markdown) {
  return markdown.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    return trimmed === "sast/" || trimmed === "/sast/";
  });
}

function extractSettings(markdown, label, errors) {
  const match = markdown.match(/%% kanban:settings\n```([^\n]*)\n([\s\S]*?)\n```\n%%/);
  if (!match) {
    errors.push(`${label} is missing a kanban settings block`);
    return null;
  }

  try {
    return JSON.parse(match[2]);
  } catch (error) {
    errors.push(`${label} has invalid kanban settings JSON: ${error.message}`);
    return null;
  }
}

function requiredTagKeys() {
  return requiredTriageTags.flatMap((tag) => [`#${tag}`, tag]);
}

function verifyTagColors(settings, label, errors, checks) {
  if (!settings) return;

  const tagColors = settings["tag-colors"];
  if (!Array.isArray(tagColors)) {
    errors.push(`${label} settings are missing tag-colors`);
    return;
  }

  const present = new Set(
    tagColors
      .filter((entry) => entry && typeof entry.tagKey === "string")
      .map((entry) => entry.tagKey),
  );
  const missing = requiredTagKeys().filter((tagKey) => !present.has(tagKey));

  if (missing.length > 0) {
    errors.push(`${label} settings are missing tag-colors for: ${missing.join(", ")}`);
    return;
  }

  checks.push(`${label} has canonical Kanban tag colors`);
}

function laneNames(markdown) {
  return [...markdown.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());
}

function laneForTicket(markdown, ticketId) {
  const lines = markdown.split(/\r?\n/);
  const cardIndex = lines.findIndex((line) => /^- \[[ xX]\]/.test(line) && line.includes(ticketId));
  if (cardIndex === -1) return null;

  for (let index = cardIndex - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/^##\s+(.+)$/);
    if (match) return match[1].trim();
  }

  return null;
}

function normalizePlanReference(value) {
  let reference = value.trim();
  const markdownLink = reference.match(/^\[[^\]]+\]\(([^)]+)\)$/);
  if (markdownLink) reference = markdownLink[1].trim();

  if (reference.startsWith("`") && reference.endsWith("`")) {
    reference = reference.slice(1, -1).trim();
  }

  return reference;
}

function planReferences(markdown) {
  return [...markdown.matchAll(/^\s*-\s+Plan:\s+(.+?)\s*$/gm)].map((match) =>
    normalizePlanReference(match[1]),
  );
}

function countAgentSkillsSections(markdown) {
  return [...markdown.matchAll(/^## Agent skills\s*$/gm)].length;
}

function expect(condition, passMessage, failMessage, errors, checks) {
  if (condition) {
    checks.push(passMessage);
    return;
  }

  errors.push(failMessage);
}

function verifyGeneratedDocs(projectRoot, errors, checks) {
  for (const doc of requiredGeneratedDocAnchors) {
    const filePath = path.join(projectRoot, doc.relativePath);
    const markdown = readFileIfExists(filePath);
    if (markdown === null) continue;

    for (const anchor of doc.anchors) {
      expect(
        markdown.includes(anchor),
        `${doc.relativePath} contains current workflow contract text`,
        `${doc.relativePath} is stale or missing expected text: ${anchor}`,
        errors,
        checks,
      );
    }
  }
}

function verifyBoardPlanReferences(projectRoot, planDir, board, errors, checks) {
  const references = planReferences(board);
  expect(
    references.length > 0,
    "board cards include plan references",
    "board has no Plan references",
    errors,
    checks,
  );

  for (const reference of references) {
    if (!reference) {
      errors.push("board contains an empty Plan reference");
      continue;
    }

    const expanded = expandHome(reference);
    const resolved = path.isAbsolute(expanded)
      ? path.resolve(expanded)
      : path.resolve(projectRoot, expanded);

    if (!isInsideOrEqual(projectRoot, resolved)) {
      errors.push(`board Plan reference must stay inside the project root: ${reference}`);
      continue;
    }

    if (planDir !== null && !isInsideOrEqual(planDir, resolved)) {
      errors.push(`board Plan reference must live under docs/plans: ${reference}`);
      continue;
    }

    expect(
      fs.existsSync(resolved),
      `board Plan reference exists: ${reference}`,
      `board Plan reference is missing: ${reference}`,
      errors,
      checks,
    );
  }
}

function verifyProject(options) {
  const errors = [];
  const warnings = [];
  const checks = [];
  const projectRoot = options.projectRoot;

  expect(
    fs.existsSync(projectRoot),
    `project root exists: ${displayPath(projectRoot)}`,
    `project root does not exist: ${displayPath(projectRoot)}`,
    errors,
    checks,
  );

  const envExamplePath = path.join(projectRoot, ".env.example");
  const envExample = readFileIfExists(envExamplePath);
  expect(
    envExample !== null && new RegExp(`^${vaultEnvVar}=`, "m").test(envExample),
    ".env.example documents PROJECT_WORKFLOW_OBSIDIAN_VAULT",
    `.env.example is missing ${vaultEnvVar}`,
    errors,
    checks,
  );

  const gitignorePath = path.join(projectRoot, ".gitignore");
  const gitignore = readFileIfExists(gitignorePath);
  expect(
    gitignore !== null && gitignoreIgnoresEnv(gitignore),
    ".gitignore ignores .env",
    ".gitignore does not ignore .env",
    errors,
    checks,
  );
  expect(
    gitignore !== null && gitignoreIgnoresSast(gitignore),
    ".gitignore ignores sast/",
    ".gitignore does not ignore sast/",
    errors,
    checks,
  );

  const envPath = path.join(projectRoot, ".env");
  const env = readFileIfExists(envPath);
  const projectEnv = env === null ? new Map() : parseEnv(env);
  expect(
    projectEnv.has(vaultEnvVar) && Boolean(projectEnv.get(vaultEnvVar)?.trim()),
    ".env defines PROJECT_WORKFLOW_OBSIDIAN_VAULT",
    `.env is missing ${vaultEnvVar}`,
    errors,
    checks,
  );

  const workflowPath = path.join(projectRoot, "docs", "agents", "project-workflow.json");
  const workflow = readJson(workflowPath, errors);
  const sequencePath = workflow
    ? resolveRepoPath(projectRoot, workflow.ticketSequencePath, "ticketSequencePath", errors)
    : null;
  const planDir = workflow ? resolveRepoPath(projectRoot, workflow.planDir, "planDir", errors) : null;
  const templatePath = workflow
    ? resolveRepoPath(projectRoot, workflow.kanbanTemplatePath, "kanbanTemplatePath", errors)
    : null;

  if (workflow) {
    expect(
      workflow.provider === "obsidian-kanban",
      "project-workflow.json uses Obsidian Kanban",
      "project-workflow.json provider must be obsidian-kanban",
      errors,
      checks,
    );
    expect(
      workflow.vaultEnvVar === vaultEnvVar,
      "project-workflow.json uses PROJECT_WORKFLOW_OBSIDIAN_VAULT",
      `project-workflow.json vaultEnvVar must be ${vaultEnvVar}`,
      errors,
      checks,
    );
    expect(
      workflow.boardPathStrategy === "home-relative-project-path",
      "project-workflow.json derives board paths from home-relative project paths",
      "project-workflow.json boardPathStrategy must be home-relative-project-path",
      errors,
      checks,
    );
    expect(
      workflow.kanbanTemplatePath === repoKanbanTemplatePath,
      "project-workflow.json points at the repo-local Kanban template",
      `project-workflow.json kanbanTemplatePath must be ${repoKanbanTemplatePath}`,
      errors,
      checks,
    );
    expect(
      workflow.planDir === "docs/plans",
      "project-workflow.json stores plans under docs/plans",
      "project-workflow.json planDir must be docs/plans",
      errors,
      checks,
    );
    expect(
      workflow.ticketSequencePath === "docs/agents/ticket-sequence.json",
      "project-workflow.json points at ticket-sequence.json",
      "project-workflow.json ticketSequencePath must be docs/agents/ticket-sequence.json",
      errors,
      checks,
    );
    expect(
      workflow.verifyCommand === expectedVerifyCommand,
      "project-workflow.json exposes the setup verifier command",
      "project-workflow.json verifyCommand is missing or stale",
      errors,
      checks,
    );
  }

  for (const relativePath of requiredAgentDocs) {
    const filePath = path.join(projectRoot, relativePath);
    expect(
      fs.existsSync(filePath),
      `${relativePath} exists`,
      `missing ${relativePath}`,
      errors,
      checks,
    );
  }
  verifyGeneratedDocs(projectRoot, errors, checks);

  expect(
    planDir !== null && fs.existsSync(planDir) && fs.statSync(planDir).isDirectory(),
    "docs/plans exists",
    "docs/plans is missing",
    errors,
    checks,
  );

  const agentsPath = path.join(projectRoot, "AGENTS.md");
  const agents = readFileIfExists(agentsPath);
  expect(
    agents !== null && countAgentSkillsSections(agents) === 1,
    "AGENTS.md has exactly one Agent skills section",
    "AGENTS.md must contain exactly one ## Agent skills section",
    errors,
    checks,
  );
  expect(
    agents !== null && agents.includes("verify_project_workflow.mjs"),
    "AGENTS.md documents project workflow verification",
    "AGENTS.md does not document verify_project_workflow.mjs",
    errors,
    checks,
  );
  expect(
    agents !== null && agents.includes(pathPortabilityAnchor),
    "AGENTS.md documents path portability rules",
    "AGENTS.md does not document path portability rules",
    errors,
    checks,
  );

  const claudePath = path.join(projectRoot, "CLAUDE.md");
  const claude = readFileIfExists(claudePath);
  expect(
    claude !== null &&
      claude.includes("AGENTS.md") &&
      claude.includes("canonical source") &&
      claude.includes("Do not duplicate"),
    "CLAUDE.md is a thin pointer to AGENTS.md",
    "CLAUDE.md is not the expected thin pointer to AGENTS.md",
    errors,
    checks,
  );

  const sequence = sequencePath ? readJson(sequencePath, errors) : null;
  if (sequence) {
    expect(
      typeof sequence.prefix === "string" && sequence.prefix.length > 0,
      "ticket sequence has a prefix",
      "ticket-sequence.json prefix must be a non-empty string",
      errors,
      checks,
    );
    expect(
      Number.isInteger(sequence.next) && sequence.next >= 2,
      "ticket sequence next value is initialized",
      "ticket-sequence.json next must be an integer >= 2",
      errors,
      checks,
    );
    expect(
      Number.isInteger(sequence.width) && sequence.width > 0,
      "ticket sequence width is initialized",
      "ticket-sequence.json width must be a positive integer",
      errors,
      checks,
    );
  }

  const template = templatePath ? readFileIfExists(templatePath) : null;
  expect(
    template !== null,
    "repo-local Kanban template exists",
    "repo-local Kanban template is missing",
    errors,
    checks,
  );
  if (template) {
    const bundledTemplate = readFileIfExists(bundledKanbanTemplatePath);
    expect(
      bundledTemplate !== null && template === bundledTemplate,
      "repo-local Kanban template matches the bundled workflow template",
      "repo-local Kanban template is stale; rerun setup_project_workflow.mjs to refresh it",
      errors,
      checks,
    );
    verifyTagColors(
      extractSettings(template, "repo-local Kanban template", errors),
      "repo-local Kanban template",
      errors,
      checks,
    );
  }

  const vaultPath = projectEnv.get(vaultEnvVar)
    ? path.resolve(expandHome(projectEnv.get(vaultEnvVar).trim()))
    : null;
  const boardPath =
    vaultPath && workflow && workflow.boardPathStrategy === "home-relative-project-path"
      ? path.join(
          vaultPath,
          projectRelativePath(projectRoot),
          `${titleCase(path.basename(projectRoot))} Kanban.md`,
        )
      : null;
  const board = boardPath ? readFileIfExists(boardPath) : null;

  expect(
    boardPath !== null && board !== null,
    "Obsidian Kanban board exists at the derived path",
    `Obsidian Kanban board is missing at ${boardPath ? displayPath(boardPath) : "(unknown path)"}`,
    errors,
    checks,
  );

  if (board) {
    const lanes = laneNames(board);
    for (const lane of requiredLanes) {
      expect(
        lanes.includes(lane),
        `board has ${lane} lane`,
        `board is missing ${lane} lane`,
        errors,
        checks,
      );
    }

    verifyTagColors(extractSettings(board, "board", errors), "board", errors, checks);
    verifyBoardPlanReferences(projectRoot, planDir, board, errors, checks);

    if (sequence?.prefix) {
      const bootstrapId = `${sequence.prefix}-0001`;
      expect(
        board.includes(`${bootstrapId} Initialize Project Workflow`),
        "bootstrap card exists on the board",
        `board is missing bootstrap card ${bootstrapId} Initialize Project Workflow`,
        errors,
        checks,
      );
      expect(
        laneForTicket(board, bootstrapId) === "Completed",
        "bootstrap card is in Completed",
        `bootstrap card ${bootstrapId} is not in Completed`,
        errors,
        checks,
      );

      const bootstrapPlanPath =
        planDir === null ? null : path.join(planDir, `${bootstrapId}-initialize-project-workflow.md`);
      expect(
        bootstrapPlanPath !== null && fs.existsSync(bootstrapPlanPath),
        "bootstrap plan exists under docs/plans",
        `missing bootstrap plan ${bootstrapPlanPath ? displayPath(bootstrapPlanPath) : ""}`,
        errors,
        checks,
      );
    }
  }

  if (vaultPath) {
    const pluginSettingsPath = path.join(
      vaultPath,
      ".obsidian",
      "plugins",
      "obsidian-kanban",
      "data.json",
    );
    const pluginSettings = readFileIfExists(pluginSettingsPath);

    if (pluginSettings === null) {
      warnings.push(
        `Obsidian Kanban plugin settings not found at ${displayPath(pluginSettingsPath)}; board-local tag colors were still verified`,
      );
    } else {
      try {
        verifyTagColors(
          JSON.parse(pluginSettings),
          "vault-level Obsidian Kanban plugin settings",
          errors,
          checks,
        );
      } catch (error) {
        errors.push(
          `invalid JSON in ${displayPath(pluginSettingsPath)}: ${error.message}`,
        );
      }
    }
  }

  return { checks, errors, warnings };
}

function run() {
  const options = parseArgs(process.argv.slice(2));
  const result = verifyProject(options);

  if (result.errors.length > 0) {
    console.error("Project workflow verification failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    if (result.warnings.length > 0) {
      console.error("Warnings:");
      for (const warning of result.warnings) {
        console.error(`- ${warning}`);
      }
    }
    process.exit(1);
  }

  console.log("Project workflow verification passed:");
  console.log(`- Checks passed: ${result.checks.length}`);
  if (result.warnings.length > 0) {
    console.log(`- Warnings: ${result.warnings.length}`);
    for (const warning of result.warnings) {
      console.log(`  - ${warning}`);
    }
  }
}

try {
  run();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
