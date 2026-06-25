import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const implementReviewSkill = path.join(repoRoot, "implement-review", "SKILL.md");
const securityScanSkill = path.join(repoRoot, "security-scan", "SKILL.md");
const retiredSkillName = ["implement", "review", "security"].join("-");

test("implement-review does not invoke security-scan", async () => {
  const content = await fs.readFile(implementReviewSkill, "utf8");

  assert.match(content, /^name: implement-review$/m);
  assert.doesNotMatch(content, /security-scan/);
  assert.doesNotMatch(content, /security scan/i);
});

test("security-scan is manual trigger only", async () => {
  const content = await fs.readFile(securityScanSkill, "utf8");

  assert.match(content, /Use only when\s+the user explicitly asks/);
  assert.ok(!content.includes(retiredSkillName));
  assert.doesNotMatch(content, /invoked by\s+implement-review/);
});
