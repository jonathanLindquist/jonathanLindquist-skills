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
