import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("skill front matter avoids YAML-unsafe plain scalars", async () => {
  const skillFiles = await findSkillFiles(repoRoot);
  assert.ok(skillFiles.length > 0, "expected at least one skill file");

  for (const skillFile of skillFiles) {
    const content = await fs.readFile(skillFile, "utf8");
    const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    assert.ok(frontMatter, `${relative(skillFile)} must start with YAML front matter`);

    const lines = frontMatter[1].split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const scalar = line.match(/^([A-Za-z0-9_-]+):\s+(.+)$/);
      if (!scalar) continue;

      const [, key, value] = scalar;
      if (/^(["'{[|>])/.test(value)) continue;

      assert.doesNotMatch(
        value,
        /:\s/,
        `${relative(skillFile)}:${index + 2} ${key} must quote or fold colon-space values`,
      );
    }
  }
});

async function findSkillFiles(root) {
  const skillFiles = [];
  const entries = await fs.readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;

    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      skillFiles.push(...(await findSkillFiles(entryPath)));
      continue;
    }

    if (entry.name === "SKILL.md") {
      skillFiles.push(entryPath);
    }
  }

  return skillFiles;
}

function relative(filePath) {
  return path.relative(repoRoot, filePath);
}
