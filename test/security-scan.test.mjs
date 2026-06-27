import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const securityScanRoot = path.join(repoRoot, "skills", "security-scan");
const subskillsRoot = path.join(securityScanRoot, "subskills");
const expectedSubskills = [
  "sast-businesslogic",
  "sast-fileupload",
  "sast-graphql",
  "sast-idor",
  "sast-jwt",
  "sast-missingauth",
  "sast-pathtraversal",
  "sast-rce",
  "sast-sqli",
  "sast-ssrf",
  "sast-ssti",
  "sast-xss",
  "sast-xxe",
];

test("security-scan vendors exactly the 13 detection subskills", async () => {
  const entries = await fs.readdir(subskillsRoot, { withFileTypes: true });
  const subskillNames = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  assert.deepEqual(subskillNames, expectedSubskills);
  assert.ok(!subskillNames.includes("sast-analysis"));
  assert.ok(!subskillNames.includes("sast-report"));
  assert.ok(!subskillNames.includes("sast-hardcodedsecrets"));
});

test("vendored detection subskills keep valid skill metadata and license", async () => {
  for (const subskillName of expectedSubskills) {
    const skillPath = path.join(subskillsRoot, subskillName, "SKILL.md");
    const content = await fs.readFile(skillPath, "utf8");
    assert.match(content, /^---\n/);
    assert.match(content, new RegExp(`\\nname: ${subskillName}\\n`));
    assert.match(content, /\ndescription: >-\n/);
  }

  const license = await fs.readFile(
    path.join(subskillsRoot, "utkusen-sast-skills-LICENSE"),
    "utf8",
  );
  assert.match(license, /^MIT License/);
  assert.match(license, /Copyright \(c\) 2026 Utku Sen/);
});

test("security-scan refreshes the architecture snapshot before checks", async () => {
  const content = await fs.readFile(path.join(securityScanRoot, "SKILL.md"), "utf8");

  assert.match(content, /create or refresh `sast\/architecture\.md`/);
  assert.match(content, /internal interface/);
  assert.match(content, /Change Impact Notes/);
  assert.match(content, /durable repo docs/);
});

test("security-scan skips subskills with bypass front matter", async () => {
  const content = await fs.readFile(path.join(securityScanRoot, "SKILL.md"), "utf8");
  const checks = parseCheckRows(content);

  assert.deepEqual(
    checks.map((check) => check.skill).sort(),
    expectedSubskills,
  );
  assert.match(
    content,
    /Skip any check\/sub-skill that has `bypass: true` in the front-matter/,
  );

  const metadataBySkill = new Map();
  for (const subskillName of expectedSubskills) {
    const skillPath = path.join(subskillsRoot, subskillName, "SKILL.md");
    const skillContent = await fs.readFile(skillPath, "utf8");
    metadataBySkill.set(subskillName, parseFrontMatter(skillContent, skillPath));
  }

  const bypassedChecks = checks
    .filter((check) => metadataBySkill.get(check.skill)?.bypass === true)
    .map((check) => check.skill)
    .sort();
  const pendingChecks = checks
    .filter((check) => metadataBySkill.get(check.skill)?.bypass !== true)
    .map((check) => check.skill)
    .sort();
  const bypassedResultFiles = checks
    .filter((check) => metadataBySkill.get(check.skill)?.bypass === true)
    .map((check) => check.resultsFile)
    .sort();

  assert.deepEqual(bypassedChecks, ["sast-graphql"]);
  assert.deepEqual(bypassedResultFiles, ["sast/graphql-results.md"]);
  assert.deepEqual(
    pendingChecks,
    expectedSubskills.filter((subskillName) => subskillName !== "sast-graphql"),
  );
});

function parseCheckRows(content) {
  return content
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| `sast-"))
    .map((line) => {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const skill = cells[0]?.match(/^`([^`]+)`$/)?.[1];
      const resultsFile = cells[2]?.match(/^`([^`]+)`$/)?.[1];

      assert.ok(skill, `could not parse skill from check row: ${line}`);
      assert.ok(resultsFile, `could not parse results file from check row: ${line}`);

      return { skill, resultsFile };
    });
}

function parseFrontMatter(content, skillPath) {
  const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(
    frontMatter,
    `${path.relative(repoRoot, skillPath)} must start with YAML front matter`,
  );

  const metadata = {};
  for (const line of frontMatter[1].split(/\r?\n/)) {
    const scalar = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!scalar) continue;

    const [, key, value] = scalar;
    if (value === "true") {
      metadata[key] = true;
    } else if (value === "false") {
      metadata[key] = false;
    } else {
      metadata[key] = value;
    }
  }

  return metadata;
}
