import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = path.join(repoRoot, "skills", "to-spec-jl");

test("to-spec-jl remains manual and keeps specs separate from tickets", async () => {
  const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8");
  const openaiConfig = await fs.readFile(
    path.join(skillRoot, "agents", "openai.yaml"),
    "utf8",
  );

  assert.match(skill, /^name: to-spec-jl$/m);
  assert.match(skill, /^disable-model-invocation: true$/m);
  assert.match(skill, /Use only when\s+the user explicitly invokes \$to-spec-jl/);
  assert.match(openaiConfig, /^\s*allow_implicit_invocation: false$/m);

  assert.match(skill, /If neither exists, create `docs\/spec\/`/);
  assert.match(skill, /If only one of those directories already exists, use it/);
  assert.match(skill, /Do not create an issue, Kanban card, tracker ticket/);
  assert.match(skill, /Do not run `new_project_ticket\.mjs`/);
  assert.match(skill, /do not invoke it automatically/);
  assert.match(skill, /\$to-tickets <spec-path>/);
  assert.match(skill, /Do not pre-write the issue backlog/);
});

test("to-spec-jl defines a complete epic implementation spec", async () => {
  const skill = await fs.readFile(path.join(skillRoot, "SKILL.md"), "utf8");

  for (const heading of [
    "## Problem Statement",
    "## Goals and Success Measures",
    "## Functional Requirements",
    "## Non-Functional Requirements",
    "## Technical Design",
    "## Implementation Strategy",
    "## Testing Strategy",
    "## Rollout, Migration, and Rollback",
    "## Risks and Mitigations",
    "## Epic Acceptance Criteria",
    "## Assumptions",
    "## Open Questions",
  ]) {
    assert.match(skill, new RegExp(`^${escapeRegExp(heading)}$`, "m"));
  }

  assert.match(skill, /highest meaningful existing test seam/);
  assert.match(skill, /stable identifier such as `FR-1`/);
  assert.match(skill, /Keep this at epic level; do not draft tickets/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
