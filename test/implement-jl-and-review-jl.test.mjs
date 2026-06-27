import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(repoRoot, "skills");
const implementSkill = path.join(skillsRoot, "implement-jl", "SKILL.md");
const reviewSkill = path.join(skillsRoot, "review-jl", "SKILL.md");
const securityScanSkill = path.join(skillsRoot, "security-scan", "SKILL.md");

test("implement-jl skill stays implementation-only", async () => {
  const content = await fs.readFile(implementSkill, "utf8");

  assert.match(content, /^name: implement-jl$/m);
  assert.match(content, /Before editing, identify the relevant test seam/);
  assert.match(content, /without performing a review pass/);
  assert.doesNotMatch(content, /thermo/i);
  assert.doesNotMatch(content, /\$review-jl/);
  assert.doesNotMatch(content, /security-scan/);
  assert.doesNotMatch(content, /security scan/i);
});

test("review-jl skill delegates Thermos passes to subagents", async () => {
  const content = await fs.readFile(reviewSkill, "utf8");

  assert.match(content, /^name: review-jl$/m);
  assert.match(content, /\$thermo-nuclear-review/);
  assert.match(content, /\$thermo-nuclear-code-quality-review/);
  assert.match(content, /subagents/i);
  assert.match(content, /send their findings back to this parent review agent/);
  assert.match(content, /git rev-parse <fixed-point>/);
  assert.match(content, /git diff <fixed-point>\.\.\.HEAD/);
  assert.match(content, /git status --short/);
  assert.match(content, /staged, unstaged, and relevant untracked file content/);
  assert.match(content, /Source request, issue, PRD, ticket plan, or spec/);
  assert.match(content, /Repo standards and instructions/);
  assert.match(content, /coverage note/);
  assert.doesNotMatch(content, /^## Standards$/m);
  assert.doesNotMatch(content, /^## Spec$/m);
  assert.doesNotMatch(content, /security-scan/);
});

test("security-scan is manual trigger only", async () => {
  const content = await fs.readFile(securityScanSkill, "utf8");

  assert.match(content, /Use only when\s+the user explicitly asks/);
  assert.doesNotMatch(content, /implement-review/);
  assert.doesNotMatch(content, /\$implement\b/);
  assert.doesNotMatch(content, /\$review\b/);
  assert.doesNotMatch(content, /invoked by\s+review-jl/);
});
