import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(repoRoot, "skills");
const uninstallScript = path.join(repoRoot, "scripts", "uninstall.mjs");
const receiptName = ".jonathan-lindquist-skills-install.json";
const implementSkill = "implement-jl";
const setupSkill = "setup-project-workflow";

test("uninstalling one owned symlink removes only the installation and preserves its source", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const unrelatedSkill = await createUnrelatedSkill(context.target);
  const sourceSkill = path.join(skillsRoot, setupSkill, "SKILL.md");

  const result = runUninstall(["--skill", setupSkill], context);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await pathExists(installedSkill), false);
  assert.equal(await pathExists(unrelatedSkill), true);
  assert.equal(await pathExists(sourceSkill), true);
});

test("comma-separated and repeated skill selectors uninstall a deduplicated set", async (t) => {
  const context = await tempContext(t);
  const firstSkill = await createOwnedSymlink(context.target, implementSkill);
  const secondSkill = await createOwnedSymlink(context.target, setupSkill);

  const result = runUninstall(
    ["--skill", `${implementSkill}, ${setupSkill}`, "--skill", implementSkill],
    context,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await pathExists(firstSkill), false);
  assert.equal(await pathExists(secondSkill), false);
  assert.equal(result.stdout.match(/implement-jl: unlink/g)?.length, 1);
});

test("empty names in a comma-separated skill list fail before removal", async (t) => {
  const context = await tempContext(t);
  const firstSkill = await createOwnedSymlink(context.target, implementSkill);
  const secondSkill = await createOwnedSymlink(context.target, setupSkill);

  const result = runUninstall(
    ["--skill", `${implementSkill},,${setupSkill}`],
    context,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /empty skill name/);
  assert.equal(await pathExists(firstSkill), true);
  assert.equal(await pathExists(secondSkill), true);
});

test("--all removes only owned symlinks and leaves foreign entries unchanged", async (t) => {
  const context = await tempContext(t);
  const ownedSkill = await createOwnedSymlink(context.target, implementSkill);
  const foreign = await createForeignSymlink(context, setupSkill);
  const unrelatedSkill = await createUnrelatedSkill(context.target);

  const result = runUninstall(["--all"], context);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await pathExists(ownedSkill), false);
  assert.equal(await pathExists(foreign.installedPath), true);
  assert.equal(await fs.readlink(foreign.installedPath), foreign.sourcePath);
  assert.equal(await pathExists(unrelatedSkill), true);
});

test("real directories are never treated as uninstallable skill links", async (t) => {
  const context = await tempContext(t);
  const directory = path.join(context.target, setupSkill);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, "keep.txt"), "keep me\n");

  const result = runUninstall(["--skill", setupSkill], context);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /non-symlink skill entry/);
  assert.equal(await fs.readFile(path.join(directory, "keep.txt"), "utf8"), "keep me\n");
});

test("batch ownership preflight prevents partial removal when one primary symlink is foreign", async (t) => {
  const context = await tempContext(t);
  const ownedSkill = await createOwnedSymlink(context.target, implementSkill);
  const foreign = await createForeignSymlink(context, setupSkill);

  const result = runUninstall(
    ["--skill", implementSkill, "--skill", setupSkill],
    context,
  );

  assert.notEqual(result.status, 0);
  assert.equal(await pathExists(ownedSkill), true);
  assert.equal(await pathExists(foreign.installedPath), true);
});

test("a retired broken repo symlink is removable and the same command can be repeated", async (t) => {
  const context = await tempContext(t);
  const retiredSkill = "retired-repo-skill";
  const installedPath = path.join(context.target, retiredSkill);
  await fs.mkdir(context.target, { recursive: true });
  await fs.symlink(path.join(skillsRoot, retiredSkill), installedPath, "dir");

  const first = runUninstall(["--skill", retiredSkill], context);
  const second = runUninstall(["--skill", retiredSkill], context);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await pathExists(installedPath), false);
  assert.match(second.stdout, /not installed/);
});

test("missing current and unknown valid skill names are idempotent no-ops", async (t) => {
  const context = await tempContext(t);

  for (const name of [setupSkill, "not-from-this-repo"]) {
    const first = runUninstall(["--skill", name], context);
    const second = runUninstall(["--skill", name], context);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /not installed/);
  }
});

test("uninstall requires exactly one selector mode before touching the target", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);

  const missingSelector = runUninstall([], context);
  const mixedSelectors = runUninstall(["--all", "--skill", setupSkill], context);

  assert.notEqual(missingSelector.status, 0);
  assert.notEqual(mixedSelectors.status, 0);
  assert.equal(await pathExists(installedSkill), true);
});

test("a target overlapping the repository is rejected before source mutation", async (t) => {
  const context = await tempContext(t);
  const sourceSkill = path.join(skillsRoot, setupSkill, "SKILL.md");

  const result = runUninstallAtTarget(["--skill", setupSkill], context, skillsRoot);

  assert.notEqual(result.status, 0);
  assert.equal(await pathExists(sourceSkill), true);
});

test("provider cleanup removes direct-source and direct-primary links and repeats cleanly", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const directSourceRoot = path.join(context.workspace, "provider-direct-source");
  const directPrimaryRoot = path.join(context.workspace, "provider-direct-primary");
  const directSource = await createProviderLink(
    directSourceRoot,
    setupSkill,
    path.join(skillsRoot, setupSkill),
  );
  const directPrimary = await createProviderLink(
    directPrimaryRoot,
    setupSkill,
    installedSkill,
  );
  const configPath = await writeAgentSyncConfig(context, [
    directSourceRoot,
    directPrimaryRoot,
  ]);
  const args = [
    "--skill",
    setupSkill,
    "--remove-provider-links",
    "--agent-sync-config",
    configPath,
  ];

  const first = runUninstall(args, context);
  const second = runUninstall(args, context);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await pathExists(directSource), false);
  assert.equal(await pathExists(directPrimary), false);
  assert.equal(await pathExists(installedSkill), false);
  assert.equal(await pathExists(path.join(skillsRoot, setupSkill, "SKILL.md")), true);
});

test("provider cleanup deduplicates physical target aliases", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const providerRoot = path.join(context.workspace, "provider-real");
  const providerAlias = path.join(context.workspace, "provider-alias");
  const providerSkill = await createProviderLink(
    providerRoot,
    setupSkill,
    path.join(skillsRoot, setupSkill),
  );
  await fs.symlink(providerRoot, providerAlias, "dir");
  const configPath = await writeAgentSyncConfig(context, [providerRoot, providerAlias]);

  const result = runUninstall(
    ["--skill", setupSkill, "--remove-provider-links", "--agent-sync-config", configPath],
    context,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await pathExists(providerSkill), false);
  assert.equal(await pathExists(installedSkill), false);
  assert.equal(result.stdout.match(/unlink provider/g)?.length, 1);
});

test("provider cleanup accepts a configured physical source behind a target alias", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const targetAlias = path.join(context.workspace, "target-alias");
  await fs.symlink(context.target, targetAlias, "dir");
  const providerRoot = path.join(context.workspace, "provider-source-alias");
  const providerSkill = await createProviderLink(providerRoot, setupSkill, installedSkill);
  const configPath = await writeAgentSyncConfig(context, [providerRoot]);

  const result = runUninstallAtTarget(
    ["--skill", setupSkill, "--remove-provider-links", "--agent-sync-config", configPath],
    context,
    targetAlias,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await pathExists(providerSkill), false);
  assert.equal(await pathExists(installedSkill), false);
});

test("a retired provider-only link can be cleaned repeatedly", async (t) => {
  const context = await tempContext(t);
  const retiredSkill = "retired-provider-skill";
  const providerRoot = path.join(context.workspace, "provider-retired");
  const providerSkill = await createProviderLink(
    providerRoot,
    retiredSkill,
    path.join(skillsRoot, retiredSkill),
  );
  const configPath = await writeAgentSyncConfig(context, [providerRoot]);
  const args = [
    "--skill",
    retiredSkill,
    "--remove-provider-links",
    "--agent-sync-config",
    configPath,
  ];

  const first = runUninstall(args, context);
  const second = runUninstall(args, context);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await pathExists(providerSkill), false);
  assert.match(second.stdout, /not installed/);
});

test("foreign provider links and directories are preserved while owned links converge", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const ownedRoot = path.join(context.workspace, "provider-owned");
  const foreignRoot = path.join(context.workspace, "provider-foreign");
  const directoryRoot = path.join(context.workspace, "provider-directory");
  const foreignSource = path.join(context.workspace, "foreign-provider-source");
  await fs.mkdir(foreignSource, { recursive: true });
  const ownedProvider = await createProviderLink(
    ownedRoot,
    setupSkill,
    path.join(skillsRoot, setupSkill),
  );
  const foreignProvider = await createProviderLink(foreignRoot, setupSkill, foreignSource);
  const directoryProvider = path.join(directoryRoot, setupSkill);
  await fs.mkdir(directoryProvider, { recursive: true });
  await fs.writeFile(path.join(directoryProvider, "keep.txt"), "keep me\n");
  const configPath = await writeAgentSyncConfig(context, [
    ownedRoot,
    foreignRoot,
    directoryRoot,
  ]);

  const result = runUninstall(
    ["--skill", setupSkill, "--remove-provider-links", "--agent-sync-config", configPath],
    context,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await pathExists(ownedProvider), false);
  assert.equal(await pathExists(foreignProvider), true);
  assert.equal(await fs.readlink(foreignProvider), foreignSource);
  assert.equal(await fs.readFile(path.join(directoryProvider, "keep.txt"), "utf8"), "keep me\n");
  assert.equal(await pathExists(installedSkill), false);
  assert.equal(result.stdout.match(/left provider unchanged/g)?.length, 2);
});

test("recorded provider destinations survive agent-sync destination and source config drift", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const oldProviderRoot = path.join(context.workspace, "provider-old");
  const oldProvider = await createProviderLink(
    oldProviderRoot,
    setupSkill,
    path.join(skillsRoot, setupSkill),
  );
  await writeReceipt(context.target, {
    [setupSkill]: receiptEntry(setupSkill, [oldProviderRoot]),
  });
  const changedSource = path.join(context.workspace, "changed-source");
  const newProviderRoot = path.join(context.workspace, "provider-new");
  const configPath = await writeAgentSyncConfig(context, [newProviderRoot], {
    sourceDir: changedSource,
  });

  const result = runUninstall(
    ["--skill", setupSkill, "--remove-provider-links", "--agent-sync-config", configPath],
    context,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await pathExists(oldProvider), false);
  assert.equal(await pathExists(installedSkill), false);
  assert.deepEqual(await readReceiptSkills(context.target), {});
});

test("--all provider cleanup is idempotent across repeated runs", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const providerRoot = path.join(context.workspace, "provider-all");
  const providerSkill = await createProviderLink(
    providerRoot,
    setupSkill,
    path.join(skillsRoot, setupSkill),
  );
  const configPath = await writeAgentSyncConfig(context, [providerRoot]);
  const args = ["--all", "--remove-provider-links", "--agent-sync-config", configPath];

  const first = runUninstall(args, context);
  const second = runUninstall(args, context);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await pathExists(installedSkill), false);
  assert.equal(await pathExists(providerSkill), false);
});

test("--all does not claim provider links for unrelated catalog skills", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const unrelatedPrimary = await createUnrelatedSkill(context.target);
  const unrelatedName = path.basename(unrelatedPrimary);
  const providerRoot = path.join(context.workspace, "provider-mixed-catalog");
  const ownedProvider = await createProviderLink(
    providerRoot,
    setupSkill,
    path.join(skillsRoot, setupSkill),
  );
  const unrelatedProvider = await createProviderLink(
    providerRoot,
    unrelatedName,
    unrelatedPrimary,
  );
  const configPath = await writeAgentSyncConfig(context, [providerRoot]);

  const result = runUninstall(
    ["--all", "--remove-provider-links", "--agent-sync-config", configPath],
    context,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await pathExists(installedSkill), false);
  assert.equal(await pathExists(ownedProvider), false);
  assert.equal(await pathExists(unrelatedPrimary), true);
  assert.equal(await pathExists(unrelatedProvider), true);
  assert.equal(await fs.readlink(unrelatedProvider), unrelatedPrimary);
});

test("provider config validation and source mismatch fail before mutation", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const malformedConfig = path.join(context.workspace, "malformed-agent-sync.json");
  await fs.writeFile(malformedConfig, '{"artifacts":[{"type":"skills"}]}\n');

  const malformed = runUninstall(
    [
      "--skill",
      setupSkill,
      "--remove-provider-links",
      "--agent-sync-config",
      malformedConfig,
    ],
    context,
  );
  assert.notEqual(malformed.status, 0);
  assert.equal(await pathExists(installedSkill), true);

  const mismatchConfig = await writeAgentSyncConfig(context, [], {
    sourceDir: path.join(context.workspace, "somewhere-else"),
  });
  const mismatch = runUninstall(
    [
      "--skill",
      setupSkill,
      "--remove-provider-links",
      "--agent-sync-config",
      mismatchConfig,
    ],
    context,
  );
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /not a skills source/);
  assert.equal(await pathExists(installedSkill), true);
});

test("dry run reports owned removals and foreign skips without changing anything", async (t) => {
  const context = await tempContext(t);
  const installedSkill = await createOwnedSymlink(context.target, setupSkill);
  const ownedRoot = path.join(context.workspace, "provider-dry-run");
  const foreignRoot = path.join(context.workspace, "provider-dry-run-foreign");
  const foreignSource = path.join(context.workspace, "foreign-dry-run-source");
  await fs.mkdir(foreignSource, { recursive: true });
  const ownedProvider = await createProviderLink(ownedRoot, setupSkill, installedSkill);
  const foreignProvider = await createProviderLink(foreignRoot, setupSkill, foreignSource);
  await writeReceipt(context.target, {
    [setupSkill]: receiptEntry(setupSkill, [ownedRoot, foreignRoot]),
  });
  const configPath = await writeAgentSyncConfig(context, [ownedRoot, foreignRoot]);

  const result = runUninstall(
    [
      "--skill",
      setupSkill,
      "--remove-provider-links",
      "--agent-sync-config",
      configPath,
      "--dry-run",
    ],
    context,
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(await pathExists(installedSkill), true);
  assert.equal(await pathExists(ownedProvider), true);
  assert.equal(await pathExists(foreignProvider), true);
  assert.deepEqual(await readReceiptSkills(context.target), {
    [setupSkill]: receiptEntry(setupSkill, [ownedRoot, foreignRoot]),
  });
  assert.match(result.stdout, /would unlink provider/);
  assert.match(result.stdout, /would leave provider unchanged/);
});

function runUninstall(args, { homeDir, target }) {
  return runUninstallAtTarget(args, { homeDir }, target);
}

function runUninstallAtTarget(args, { homeDir }, target) {
  return spawnSync(process.execPath, [uninstallScript, ...args, "--target", target], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: path.join(homeDir, ".codex"),
      HOME: homeDir,
    },
  });
}

async function tempContext(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "jonathan-skills-uninstall-test-"));
  const homeDir = path.join(workspace, "home");
  const target = path.join(workspace, "target", "skills");
  await fs.mkdir(homeDir, { recursive: true });

  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  return { homeDir, target, workspace };
}

async function createOwnedSymlink(target, skillName) {
  const installedPath = path.join(target, skillName);
  await fs.mkdir(target, { recursive: true });
  await fs.symlink(path.join(skillsRoot, skillName), installedPath, "dir");
  return installedPath;
}

async function createForeignSymlink(context, skillName) {
  const sourcePath = path.join(context.workspace, "foreign-sources", skillName);
  const installedPath = path.join(context.target, skillName);
  await fs.mkdir(sourcePath, { recursive: true });
  await fs.writeFile(path.join(sourcePath, "SKILL.md"), `foreign ${skillName}\n`);
  await fs.mkdir(context.target, { recursive: true });
  await fs.symlink(sourcePath, installedPath, "dir");
  return { installedPath, sourcePath };
}

async function createUnrelatedSkill(target) {
  const unrelatedSkill = path.join(target, "third-party-skill");
  await fs.mkdir(unrelatedSkill, { recursive: true });
  await fs.writeFile(path.join(unrelatedSkill, "SKILL.md"), "third party\n");
  return unrelatedSkill;
}

async function createProviderLink(providerRoot, skillName, linkTarget) {
  const providerSkill = path.join(providerRoot, skillName);
  await fs.mkdir(providerRoot, { recursive: true });
  await fs.symlink(linkTarget, providerSkill, "dir");
  return providerSkill;
}

async function writeReceipt(target, skills) {
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, receiptName),
    `${JSON.stringify(
      {
        version: 1,
        repository: "jonathanLindquist-skills",
        skills,
      },
      null,
      2,
    )}\n`,
  );
}

function receiptEntry(skillName, providerDestinations = []) {
  return {
    source: path.join(skillsRoot, skillName),
    providerDestinations,
  };
}

async function readReceiptSkills(target) {
  try {
    const receipt = JSON.parse(await fs.readFile(path.join(target, receiptName), "utf8"));
    return receipt.skills;
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeAgentSyncConfig(context, providerRoots, { sourceDir = context.target } = {}) {
  const configPath = path.join(
    context.workspace,
    `agent-sync-${Math.random().toString(16).slice(2)}.json`,
  );
  const providers = providerRoots.map((destinationDir, index) => ({
    id: `test-provider-${index + 1}`,
    flag: `--test-provider-${index + 1}`,
    label: `Test Provider ${index + 1}`,
    destinationDir,
  }));
  await fs.writeFile(
    configPath,
    `${JSON.stringify(
      {
        artifacts: [
          {
            id: "skills",
            label: "skills",
            type: "skills",
            default: true,
            sourceDir,
            providers,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return configPath;
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
