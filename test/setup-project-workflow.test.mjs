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

  const templatePath = path.join(projectRoot, "docs", "agents", "kanban-template.md");
  const template = await fs.readFile(templatePath, "utf8");
  assert.match(template, /ABC-0001 Ticket title/);
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
  assert.match(board, /"tag-colors"/);
});

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
