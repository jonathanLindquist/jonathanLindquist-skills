import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(repoRoot, "skills");
const installScript = path.join(repoRoot, "scripts", "install.mjs");
const skillName = "setup-project-workflow";

test("initial install can sync the selected skill through agent-sync", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const agentSync = await fakeAgentSync(workspace);

  const result = runInstall(
    [
      "--skill",
      skillName,
      "--sync-providers",
      "--agent-sync-bin",
      agentSync.binPath,
    ],
    homeDir,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await fs.readlink(path.join(homeDir, ".agents", "skills", skillName)),
    path.join(skillsRoot, skillName),
  );
  assert.deepEqual(await installedReceipt(homeDir), {
    [skillName]: {
      source: path.join(skillsRoot, skillName),
      providerDestinations: [],
    },
  });
  assert.deepEqual(await agentSync.calls(), [["--all-providers", "--skill", skillName]]);
});

test("provider sync records the verified provider destination for later cleanup", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const agentSync = await fakeAgentSync(workspace, { linkProvider: true });

  const result = runInstall(
    [
      "--skill",
      skillName,
      "--sync-providers",
      "--agent-sync-bin",
      agentSync.binPath,
    ],
    homeDir,
  );

  assert.equal(result.status, 0, result.stderr);
  const providerRoot = await fs.realpath(path.join(homeDir, ".claude", "skills"));
  assert.deepEqual(await installedReceipt(homeDir), {
    [skillName]: {
      source: path.join(skillsRoot, skillName),
      providerDestinations: [providerRoot],
    },
  });
  assert.equal(
    await fs.readlink(path.join(homeDir, ".claude", "skills", skillName)),
    await fs.realpath(path.join(skillsRoot, skillName)),
  );
});

test("update replaces an existing installed skill and syncs only that skill", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const agentSync = await fakeAgentSync(workspace);
  const installedSkill = path.join(homeDir, ".agents", "skills", skillName);
  await fs.mkdir(installedSkill, { recursive: true });
  await fs.writeFile(path.join(installedSkill, "SKILL.md"), "old skill\n");

  const result = runInstall(
    [
      "--update",
      "--skill",
      skillName,
      "--agent-sync-bin",
      agentSync.binPath,
    ],
    homeDir,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal((await fs.lstat(installedSkill)).isSymbolicLink(), true);
  assert.equal(await fs.readlink(installedSkill), path.join(skillsRoot, skillName));
  assert.deepEqual(await installedReceipt(homeDir), {
    [skillName]: {
      source: path.join(skillsRoot, skillName),
      providerDestinations: [],
    },
  });
  assert.deepEqual(await agentSync.calls(), [["--all-providers", "--skill", skillName]]);
});

test("copy mode is rejected before changing an existing install or syncing providers", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const agentSync = await fakeAgentSync(workspace);
  const installedSkill = path.join(homeDir, ".agents", "skills", skillName);
  await fs.mkdir(installedSkill, { recursive: true });
  await fs.writeFile(path.join(installedSkill, "keep.txt"), "keep me\n");

  const result = runInstall(
    [
      "--skill",
      skillName,
      "--mode",
      "copy",
      "--replace",
      "--sync-providers",
      "--agent-sync-bin",
      agentSync.binPath,
    ],
    homeDir,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown option: --mode/);
  assert.equal(await fs.readFile(path.join(installedSkill, "keep.txt"), "utf8"), "keep me\n");
  await assert.rejects(fs.readFile(agentSync.logPath, "utf8"), { code: "ENOENT" });
});

test("reinstalling an already-correct symlink is an idempotent success", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const installedSkill = path.join(homeDir, ".agents", "skills", skillName);
  await fs.mkdir(path.dirname(installedSkill), { recursive: true });
  await fs.symlink(path.join(skillsRoot, skillName), installedSkill, "dir");

  const result = runInstall(["--skill", skillName], homeDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already linked/);
  assert.equal(await fs.readlink(installedSkill), path.join(skillsRoot, skillName));
  assert.deepEqual(await installedReceipt(homeDir), {
    [skillName]: {
      source: path.join(skillsRoot, skillName),
      providerDestinations: [],
    },
  });
});

test("replace handles an existing broken installed symlink", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const installedSkill = path.join(homeDir, ".agents", "skills", skillName);
  await fs.mkdir(path.dirname(installedSkill), { recursive: true });
  await fs.symlink(path.join(workspace, "missing-skill-source"), installedSkill, "dir");

  const result = runInstall(["--replace", "--skill", skillName], homeDir);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readlink(installedSkill), path.join(skillsRoot, skillName));
});

test("explicit deprecated skills skip install and provider sync", async (t) => {
  const workspace = await tempWorkspace(t);

  for (const deprecatedSkill of ["implement-jl", "review-jl"]) {
    const skillWorkspace = path.join(workspace, deprecatedSkill);
    const homeDir = path.join(skillWorkspace, "home");
    await fs.mkdir(skillWorkspace, { recursive: true });
    const agentSync = await fakeAgentSync(skillWorkspace);

    const installArgs =
      deprecatedSkill === "review-jl"
        ? ["--update", "--skill", deprecatedSkill, "--agent-sync-bin", agentSync.binPath]
        : [
            "--skill",
            deprecatedSkill,
            "--sync-providers",
            "--agent-sync-bin",
            agentSync.binPath,
          ];
    const result = runInstall(installArgs, homeDir);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`${deprecatedSkill}: skipped \\(deprecated\\)`));
    assert.equal(
      await pathExists(path.join(homeDir, ".agents", "skills", deprecatedSkill)),
      false,
    );
    assert.equal(
      await pathExists(
        path.join(homeDir, ".agents", "skills", ".jonathan-lindquist-skills-install.json"),
      ),
      false,
    );
    await assert.rejects(fs.readFile(agentSync.logPath, "utf8"), { code: "ENOENT" });
  }
});

test("update refuses to run without an explicit skill", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const agentSync = await fakeAgentSync(workspace);

  const result = runInstall(["--update", "--agent-sync-bin", agentSync.binPath], homeDir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--update requires --skill <name>/);
  await assert.rejects(fs.readFile(agentSync.logPath, "utf8"), { code: "ENOENT" });
});

test("sync can target a specific agent-sync provider flag", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const agentSync = await fakeAgentSync(workspace);

  const result = runInstall(
    [
      "--skill",
      skillName,
      "--sync-providers",
      "--agent-sync-bin",
      agentSync.binPath,
      "--agent-sync-provider",
      "--claude-code",
    ],
    homeDir,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(await agentSync.calls(), [["--claude-code", "--skill", skillName]]);
});

test("provider sync rejects an install target outside the pinned agent-sync source", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const customTarget = path.join(workspace, "custom-skills");
  const agentSync = await fakeAgentSync(workspace);

  const result = runInstall(
    [
      "--skill",
      skillName,
      "--target",
      customTarget,
      "--sync-providers",
      "--agent-sync-bin",
      agentSync.binPath,
    ],
    homeDir,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a skills source/);
  assert.equal(await pathExists(customTarget), false);
  await assert.rejects(fs.readFile(agentSync.logPath, "utf8"), { code: "ENOENT" });
});

test("installing all skills exposes only installable folders under skills/", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const result = runInstall([], homeDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /implement-jl: skipped \(deprecated\)/);
  assert.match(result.stdout, /review-jl: skipped \(deprecated\)/);

  const installedSkillsRoot = path.join(homeDir, ".agents", "skills");
  const installedEntries = await fs.readdir(installedSkillsRoot);
  for (const expectedSkill of [
    "security-scan",
    "setup-project-workflow",
    "to-spec-jl",
  ]) {
    assert.ok(installedEntries.includes(expectedSkill), `${expectedSkill} should be installed`);
  }
  for (const retiredSkill of [
    "implement-jl",
    "review-jl",
    "implement-review",
    "implement",
    "review",
  ]) {
    assert.ok(!installedEntries.includes(retiredSkill), `${retiredSkill} should not install`);
  }
  assert.ok(
    !installedEntries.some((entry) => entry.startsWith("sast-")),
    "vendored SAST subskills should not install as top-level skills",
  );

  await assert.rejects(fs.lstat(path.join(installedSkillsRoot, "sast-sqli")), {
    code: "ENOENT",
  });
  assert.ok(
    await pathExists(
      path.join(
        installedSkillsRoot,
        "security-scan",
        "subskills",
        "sast-sqli",
        "SKILL.md",
      ),
    ),
  );
});

test("installing all skills fails if the skills source directory is missing", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const missingRoot = path.join(workspace, "missing-repo");
  await fs.mkdir(path.join(missingRoot, "scripts"), { recursive: true });
  await fs.cp(installScript, path.join(missingRoot, "scripts", "install.mjs"));
  await fs.cp(
    path.join(repoRoot, "scripts", "install_receipt.mjs"),
    path.join(missingRoot, "scripts", "install_receipt.mjs"),
  );
  await fs.cp(
    path.join(repoRoot, "scripts", "provider_config.mjs"),
    path.join(missingRoot, "scripts", "provider_config.mjs"),
  );
  await fs.cp(
    path.join(repoRoot, "scripts", "skill_metadata.mjs"),
    path.join(missingRoot, "scripts", "skill_metadata.mjs"),
  );
  await fs.cp(
    path.join(repoRoot, "scripts", "verify_skill_dependencies.mjs"),
    path.join(missingRoot, "scripts", "verify_skill_dependencies.mjs"),
  );
  await fs.symlink(path.join(repoRoot, "node_modules"), path.join(missingRoot, "node_modules"), "dir");

  const result = spawnSync(process.execPath, [path.join(missingRoot, "scripts", "install.mjs")], {
    cwd: missingRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: homeDir,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No skills directory found/);
});

test("installer rejects a target symlink that physically overlaps its source repo", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  const fakeRepo = path.join(workspace, "fake-repo");
  const fakeScripts = path.join(fakeRepo, "scripts");
  const fakeSkills = path.join(fakeRepo, "skills");
  const fakeSkill = path.join(fakeSkills, skillName);
  const fakeInstallScript = path.join(fakeScripts, "install.mjs");
  const targetAlias = path.join(workspace, "target-alias");
  await fs.mkdir(fakeScripts, { recursive: true });
  await fs.mkdir(fakeSkill, { recursive: true });
  await fs.writeFile(path.join(fakeSkill, "SKILL.md"), "original source\n");
  for (const scriptName of [
    "install.mjs",
    "install_receipt.mjs",
    "provider_config.mjs",
    "skill_metadata.mjs",
    "verify_skill_dependencies.mjs",
  ]) {
    await fs.cp(path.join(repoRoot, "scripts", scriptName), path.join(fakeScripts, scriptName));
  }
  await fs.symlink(path.join(repoRoot, "node_modules"), path.join(fakeRepo, "node_modules"), "dir");
  await fs.symlink(fakeSkills, targetAlias, "dir");

  const result = spawnSync(
    process.execPath,
    [
      fakeInstallScript,
      "--skill",
      skillName,
      "--target",
      targetAlias,
      "--replace",
    ],
    {
      cwd: fakeRepo,
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /overlaps this repository/);
  assert.equal(await fs.readFile(path.join(fakeSkill, "SKILL.md"), "utf8"), "original source\n");
});

function runInstall(args, homeDir) {
  return spawnSync(process.execPath, [installScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: path.join(homeDir, ".codex"),
      HOME: homeDir,
    },
  });
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function installedReceipt(homeDir) {
  const receiptPath = path.join(
    homeDir,
    ".agents",
    "skills",
    ".jonathan-lindquist-skills-install.json",
  );
  const receipt = JSON.parse(await fs.readFile(receiptPath, "utf8"));
  return receipt.skills;
}

async function tempWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "jonathan-skills-install-test-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  return workspace;
}

async function fakeAgentSync(workspace, { linkProvider = false } = {}) {
  const binPath = path.join(workspace, "fake-agent-sync.mjs");
  const logPath = path.join(workspace, "agent-sync-calls.jsonl");
  const linkProviderBody = linkProvider
    ? `
const skillIndex = process.argv.indexOf("--skill");
const skillName = process.argv[skillIndex + 1];
const primary = path.join(process.env.HOME, ".agents", "skills", skillName);
const providerRoot = path.join(process.env.HOME, ".claude", "skills");
fs.mkdirSync(providerRoot, { recursive: true });
fs.symlinkSync(fs.realpathSync(primary), path.join(providerRoot, skillName), "dir");
`
    : "";
  await fs.writeFile(
    binPath,
    `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
fs.appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(process.argv.slice(2)) + "\\n");
${linkProviderBody}
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
