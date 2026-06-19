import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installScript = path.join(repoRoot, "scripts", "install.mjs");
const skillName = "setup-project-workflow";

test("initial install can sync the selected skill through skill-organizer", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const organizer = await fakeOrganizer(workspace);

  const result = runInstall(
    [
      "--skill",
      skillName,
      "--sync-providers",
      "--organizer-bin",
      organizer.binPath,
    ],
    homeDir,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await fs.readlink(path.join(homeDir, ".agents", "skills", skillName)),
    path.join(repoRoot, skillName),
  );
  assert.deepEqual(await organizer.calls(), [["--all-providers", "--skill", skillName]]);
});

test("update replaces an existing installed skill and syncs only that skill", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const organizer = await fakeOrganizer(workspace);
  const installedSkill = path.join(homeDir, ".agents", "skills", skillName);
  await fs.mkdir(installedSkill, { recursive: true });
  await fs.writeFile(path.join(installedSkill, "SKILL.md"), "old skill\n");

  const result = runInstall(
    [
      "--update",
      "--skill",
      skillName,
      "--mode",
      "copy",
      "--organizer-bin",
      organizer.binPath,
    ],
    homeDir,
  );

  assert.equal(result.status, 0, result.stderr);
  const copiedSkill = await fs.readFile(path.join(installedSkill, "SKILL.md"), "utf8");
  assert.match(copiedSkill, /^name: setup-project-workflow/m);
  assert.deepEqual(await organizer.calls(), [["--all-providers", "--skill", skillName]]);
});

test("update refuses to run without an explicit skill", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const organizer = await fakeOrganizer(workspace);

  const result = runInstall(["--update", "--organizer-bin", organizer.binPath], homeDir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--update requires --skill <name>/);
  await assert.rejects(fs.readFile(organizer.logPath, "utf8"), { code: "ENOENT" });
});

test("sync can target a specific organizer provider flag", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const organizer = await fakeOrganizer(workspace);

  const result = runInstall(
    [
      "--skill",
      skillName,
      "--sync-providers",
      "--organizer-bin",
      organizer.binPath,
      "--organizer-provider",
      "--claude-code",
    ],
    homeDir,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await organizer.calls(), [["--claude-code", "--skill", skillName]]);
});

function runInstall(args, homeDir) {
  return spawnSync(process.execPath, [installScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
    },
  });
}

async function tempWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "jonathan-skills-install-test-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  return workspace;
}

async function fakeOrganizer(workspace) {
  const binPath = path.join(workspace, "fake-skill-organizer.mjs");
  const logPath = path.join(workspace, "organizer-calls.jsonl");
  await fs.writeFile(
    binPath,
    `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");
`,
    { mode: 0o755 },
  );

  return {
    binPath,
    logPath,
    async calls() {
      const content = await fs.readFile(logPath, "utf8");
      return content.trim().split("\\n").filter(Boolean).map((line) => JSON.parse(line));
    },
  };
}
