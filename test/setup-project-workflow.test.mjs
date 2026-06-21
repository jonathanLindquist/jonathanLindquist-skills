import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const setupScript = path.join(
  repoRoot,
  "setup-project-workflow",
  "scripts",
  "setup_project_workflow.mjs",
);
const newTicketScript = path.join(
  repoRoot,
  "setup-project-workflow",
  "scripts",
  "new_project_ticket.mjs",
);
const updateTicketScript = path.join(
  repoRoot,
  "setup-project-workflow",
  "scripts",
  "update_project_ticket.mjs",
);
const verifyScript = path.join(
  repoRoot,
  "setup-project-workflow",
  "scripts",
  "verify_project_workflow.mjs",
);

test("setup copies the bundled Kanban template into the target project", async (t) => {
  const workspace = await tempWorkspace(t);
  const projectRoot = path.join(workspace, "example-project");
  const vaultRoot = path.join(workspace, "vault");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".env"),
    `PROJECT_WORKFLOW_OBSIDIAN_VAULT=${vaultRoot}\n`,
  );

  const result = spawnSync(
    process.execPath,
    [setupScript, "--project-root", projectRoot, "--ticket-prefix", "TMP"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Project workflow verification passed:/);
  assert.match(result.stdout, /Setup complete\./);

  const templatePath = path.join(projectRoot, "docs", "agents", "kanban-template.md");
  const template = await fs.readFile(templatePath, "utf8");
  assert.match(template, /ABC-0001 Ticket title/);
  assert.match(template, /## Acceptance Criteria/);
  assert.doesNotMatch(template, /## Definition of Done/);
  assert.doesNotMatch(template, /Completion criteria:/);
  assert.match(template, /"tag-colors"/);

  const workflow = JSON.parse(
    await fs.readFile(path.join(projectRoot, "docs", "agents", "project-workflow.json"), "utf8"),
  );
  assert.equal(workflow.kanbanTemplatePath, "docs/agents/kanban-template.md");

  const issueTracker = await fs.readFile(
    path.join(projectRoot, "docs", "agents", "issue-tracker.md"),
    "utf8",
  );
  assert.match(issueTracker, /docs\/agents\/kanban-template\.md/);
  assert.doesNotMatch(issueTracker, /Z - Templates/);

  await assert.rejects(
    fs.stat(path.join(vaultRoot, "Z - Templates", "Kanban Template.md")),
    { code: "ENOENT" },
  );

  const boardPath = await findFirst(vaultRoot, (filePath) => filePath.endsWith("Kanban.md"));
  assert.ok(boardPath, "expected a Kanban board under the vault");
  const board = await fs.readFile(boardPath, "utf8");
  assert.match(board, /TMP-0001 Initialize Project Workflow/);
  assert.match(board, /## Acceptance Criteria/);
  assert.doesNotMatch(board, /## Definition of Done/);
  assert.doesNotMatch(board, /Completion criteria:/);
  assert.match(board, /"tag-colors"/);
  assert.doesNotMatch(board, /Read this card and the linked plan before implementation/);
  assert.doesNotMatch(board, /Fill in linked plan with scope and acceptance criteria/);
  assert.match(board, /Create or update `AGENTS\.md`/);
});

test("verification command fails when required setup artifacts are missing", async (t) => {
  const workspace = await tempWorkspace(t);
  const projectRoot = path.join(workspace, "example-project");
  const vaultRoot = path.join(workspace, "vault");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".env"),
    `PROJECT_WORKFLOW_OBSIDIAN_VAULT=${vaultRoot}\n`,
  );

  runOk(setupScript, ["--project-root", projectRoot, "--ticket-prefix", "TMP"]);
  await fs.rm(path.join(projectRoot, "AGENTS.md"));

  const result = runFail(verifyScript, ["--project-root", projectRoot]);
  assert.match(result.stderr, /Project workflow verification failed:/);
  assert.match(result.stderr, /AGENTS\.md must contain exactly one ## Agent skills section/);
});

test("setup can be rerun on an initialized project without resetting ticket state", async (t) => {
  const workspace = await tempWorkspace(t);
  const projectRoot = path.join(workspace, "example-project");
  const vaultRoot = path.join(workspace, "vault");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".env"),
    `PROJECT_WORKFLOW_OBSIDIAN_VAULT=${vaultRoot}\n`,
  );

  runOk(setupScript, ["--project-root", projectRoot, "--ticket-prefix", "TMP"]);
  runOk(newTicketScript, [
    "--project-root",
    projectRoot,
    "--title",
    "Follow up ticket",
  ]);

  const rerun = runOk(setupScript, ["--project-root", projectRoot]);
  assert.match(rerun.stdout, /Project workflow verification passed:/);

  const sequence = JSON.parse(
    await fs.readFile(path.join(projectRoot, "docs", "agents", "ticket-sequence.json"), "utf8"),
  );
  assert.equal(sequence.prefix, "TMP");
  assert.equal(sequence.next, 3);

  const boardPath = await findFirst(vaultRoot, (filePath) => filePath.endsWith("Kanban.md"));
  assert.ok(boardPath, "expected a Kanban board under the vault");
  const board = await fs.readFile(boardPath, "utf8");
  assert.equal([...board.matchAll(/TMP-0001 Initialize Project Workflow/g)].length, 1);
});

test("setup rejects reruns with a different ticket prefix", async (t) => {
  const workspace = await tempWorkspace(t);
  const projectRoot = path.join(workspace, "example-project");
  const vaultRoot = path.join(workspace, "vault");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".env"),
    `PROJECT_WORKFLOW_OBSIDIAN_VAULT=${vaultRoot}\n`,
  );

  runOk(setupScript, ["--project-root", projectRoot, "--ticket-prefix", "TMP"]);
  const result = runFail(setupScript, [
    "--project-root",
    projectRoot,
    "--ticket-prefix",
    "NEW",
  ]);

  assert.match(result.stderr, /Existing ticket sequence uses prefix TMP/);
});

test("new ticket writes specific checklist fields to card and plan", async (t) => {
  const workspace = await tempWorkspace(t);
  const projectRoot = path.join(workspace, "example-project");
  const vaultRoot = path.join(workspace, "vault");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".env"),
    `PROJECT_WORKFLOW_OBSIDIAN_VAULT=${vaultRoot}\n`,
  );

  runOk(setupScript, ["--project-root", projectRoot, "--ticket-prefix", "TMP"]);
  runOk(newTicketScript, [
    "--project-root",
    projectRoot,
    "--title",
    "Capture backtesting vocabulary",
    "--description",
    "Document the backtesting terms agents should use before implementation.",
    "--triage",
    "ready-for-agent",
    "--tag",
    "docs",
    "--todo",
    "Review existing strategy docs for recurring backtesting terms.",
    "--todo",
    "Add canonical glossary entries to the linked plan.",
    "--acceptance",
    "The plan defines canonical terms for signals, trades, and results.",
    "--verification",
    "Review the linked plan for unresolved TODO placeholders.",
  ]);

  const boardPath = await findFirst(vaultRoot, (filePath) => filePath.endsWith("Kanban.md"));
  assert.ok(boardPath, "expected a Kanban board under the vault");
  const board = await fs.readFile(boardPath, "utf8");
  assert.match(board, /#ready-for-agent #docs/);
  assert.match(board, /- \[ \] Review existing strategy docs for recurring backtesting terms\./);
  assert.match(board, /- \[ \] Add canonical glossary entries to the linked plan\./);
  assert.match(board, /## Acceptance Criteria/);
  assert.doesNotMatch(board, /## Definition of Done/);
  assert.doesNotMatch(board, /Completion criteria:/);
  assert.match(board, /- \[ \] The plan defines canonical terms for signals, trades, and results\./);
  assert.match(board, /## Verification/);
  assert.match(board, /- \[ \] Review the linked plan for unresolved TODO placeholders\./);
  assert.doesNotMatch(board, /Fill in linked plan with scope and acceptance criteria/);

  const planPath = path.join(
    projectRoot,
    "docs",
    "plans",
    "TMP-0002-capture-backtesting-vocabulary.md",
  );
  const plan = await fs.readFile(planPath, "utf8");
  assert.match(plan, /## Acceptance Criteria/);
  assert.doesNotMatch(plan, /## Definition of Done/);
  assert.doesNotMatch(plan, /Completion criteria:/);
  assert.match(plan, /- \[ \] Review existing strategy docs for recurring backtesting terms\./);
  assert.match(plan, /- \[ \] Add canonical glossary entries to the linked plan\./);
  assert.match(plan, /- \[ \] The plan defines canonical terms for signals, trades, and results\./);
  assert.match(plan, /- \[ \] Review the linked plan for unresolved TODO placeholders\./);
});

test("ready-for-agent tickets require specific implementation fields", async (t) => {
  const workspace = await tempWorkspace(t);
  const projectRoot = path.join(workspace, "example-project");
  const vaultRoot = path.join(workspace, "vault");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".env"),
    `PROJECT_WORKFLOW_OBSIDIAN_VAULT=${vaultRoot}\n`,
  );

  runOk(setupScript, ["--project-root", projectRoot, "--ticket-prefix", "TMP"]);
  const result = runFail(newTicketScript, [
    "--project-root",
    projectRoot,
    "--title",
    "Incomplete ready ticket",
    "--triage",
    "ready-for-agent",
  ]);

  assert.match(
    result.stderr,
    /ready-for-agent tickets require --description, --todo, --acceptance, and --verification/,
  );
});

test("title-only tickets remain draft needs-triage tickets with placeholders", async (t) => {
  const workspace = await tempWorkspace(t);
  const projectRoot = path.join(workspace, "example-project");
  const vaultRoot = path.join(workspace, "vault");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".env"),
    `PROJECT_WORKFLOW_OBSIDIAN_VAULT=${vaultRoot}\n`,
  );

  runOk(setupScript, ["--project-root", projectRoot, "--ticket-prefix", "TMP"]);
  runOk(newTicketScript, [
    "--project-root",
    projectRoot,
    "--title",
    "Draft ticket",
  ]);

  const boardPath = await findFirst(vaultRoot, (filePath) => filePath.endsWith("Kanban.md"));
  assert.ok(boardPath, "expected a Kanban board under the vault");
  const board = await fs.readFile(boardPath, "utf8");
  assert.match(board, /#needs-triage/);
  assert.match(board, /TODO: replace with a 1-3 sentence summary\./);
  assert.match(board, /TODO: add ticket-specific implementation steps before marking ready-for-agent\./);
  assert.match(board, /TODO: add ticket-specific completion criteria before marking ready-for-agent\./);
  assert.match(board, /TODO: add ticket-specific verification checks before marking ready-for-agent\./);
});

test("completed ticket insertion preserves existing completed card details", async (t) => {
  const workspace = await tempWorkspace(t);
  const projectRoot = path.join(workspace, "example-project");
  const vaultRoot = path.join(workspace, "vault");
  await fs.mkdir(projectRoot, { recursive: true });
  await fs.mkdir(vaultRoot, { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".env"),
    `PROJECT_WORKFLOW_OBSIDIAN_VAULT=${vaultRoot}\n`,
  );

  runOk(setupScript, ["--project-root", projectRoot, "--ticket-prefix", "TMP"]);
  runOk(newTicketScript, [
    "--project-root",
    projectRoot,
    "--title",
    "Implement comparison ticket",
    "--description",
    "Verify card movement keeps each card block intact.",
    "--tag",
    "tests",
  ]);
  runOk(updateTicketScript, [
    "--project-root",
    projectRoot,
    "--ticket",
    "TMP-0002",
    "--lane",
    "Completed",
    "--complete",
    "--note",
    "Verified completed lane structure.",
  ]);

  const boardPath = await findFirst(vaultRoot, (filePath) => filePath.endsWith("Kanban.md"));
  assert.ok(boardPath, "expected a Kanban board under the vault");
  const board = await fs.readFile(boardPath, "utf8");
  assert.deepEqual(boardStructureIssues(board), []);
});

function runOk(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  return result;
}

function runFail(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, result.stdout);
  return result;
}

function boardStructureIssues(markdown) {
  const lines = markdown.split(/\r?\n/);
  const issues = [];

  for (let index = 0; index < lines.length; index += 1) {
    const cardMatch = lines[index].match(/^- \[[ xX]\].*?(TMP-\d{4})/);
    if (!cardMatch) continue;

    const id = cardMatch[1];
    let end = lines.length;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (
        /^- \[[ xX]\]/.test(lines[next]) ||
        /^##\s+/.test(lines[next]) ||
        lines[next].startsWith("%% kanban:settings")
      ) {
        end = next;
        break;
      }
    }

    const block = lines.slice(index, end).join("\n");
    const ticketIds = [...block.matchAll(/- Ticket:\s+(TMP-\d{4})/g)].map((match) => match[1]);
    if (!ticketIds.includes(id)) {
      issues.push(`${id}: missing matching Ticket line before next card/lane/settings`);
    }

    for (const ticketId of ticketIds) {
      if (ticketId !== id) {
        issues.push(`${id}: contains another ticket's details (${ticketId})`);
      }
    }
  }

  const laneHeadings = ["Backlog", "In Progress", "Completed"];
  for (const match of markdown.matchAll(/^##\s+(.+)$/gm)) {
    const heading = match[1].trim();
    if (!laneHeadings.includes(heading)) {
      issues.push(`unexpected top-level heading: ${heading}`);
    }
  }

  return issues;
}

async function tempWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "setup-project-workflow-test-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  return workspace;
}

async function findFirst(root, predicate) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = await findFirst(entryPath, predicate);
      if (found) return found;
      continue;
    }
    if (predicate(entryPath)) return entryPath;
  }
  return null;
}
