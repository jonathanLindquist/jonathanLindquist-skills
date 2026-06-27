import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const verifierScript = path.join(repoRoot, "scripts", "verify_skill_dependencies.mjs");

test("review-jl dependency verification fails clearly when Thermos is missing", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");

  const result = runVerifier(["--skill", "review-jl"], homeDir);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /review-jl dependency check failed/);
  assert.match(result.stderr, /thermos/);
  assert.match(result.stderr, /jonathanlindquist-plugins/);
  assert.match(result.stderr, /thermo-nuclear-review/);
  assert.match(result.stderr, /thermo-nuclear-code-quality-review/);
  assert.match(result.stderr, /codex plugin add thermos@jonathanlindquist-plugins/);
});

test("review-jl dependency verification accepts a versioned Codex plugin cache", async (t) => {
  const workspace = await tempWorkspace(t);
  const homeDir = path.join(workspace, "home");
  await fakeThermosPlugin(homeDir);

  const result = runVerifier(["--skill", "review-jl"], homeDir);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /review-jl: dependencies ok/);
});

function runVerifier(args, homeDir) {
  return spawnSync(process.execPath, [verifierScript, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: path.join(homeDir, ".codex"),
      HOME: homeDir,
    },
  });
}

async function fakeThermosPlugin(homeDir) {
  const pluginRoot = path.join(
    homeDir,
    ".codex",
    "plugins",
    "cache",
    "jonathanlindquist-plugins",
    "thermos",
    "1.0.0",
  );
  for (const skillName of ["thermo-nuclear-review", "thermo-nuclear-code-quality-review"]) {
    const skillRoot = path.join(pluginRoot, "skills", skillName);
    await fs.mkdir(skillRoot, { recursive: true });
    await fs.writeFile(path.join(skillRoot, "SKILL.md"), `---\nname: ${skillName}\n---\n`);
  }
}

async function tempWorkspace(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "jonathan-skills-deps-test-"));
  t.after(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });
  return workspace;
}
