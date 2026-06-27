---
name: review-jl
description: >-
  Jonathan Lindquist's Thermos-backed review workflow. Review a branch, PR,
  diff, or current worktree by launching Thermos review subagents, collecting
  their findings, verifying high-signal issues, and returning a concise
  findings-first review. Use when the user asks to use review-jl, or asks for a
  JL code review, implementation review, PR review, branch audit, or
  post-implementation review.
---

# Review JL

Review the requested scope without making file changes.

This skill is the parent reviewer. It coordinates the Thermos review rubrics in
subagents, receives their findings, verifies the highest-signal issues, and
synthesizes one final review for the user.

## Workflow

1. Pin the review scope before launching subagents:
   - If the user names a fixed point such as a commit, branch, tag, or
     `HEAD~N`, confirm it resolves with `git rev-parse <fixed-point>`, then
     review `git diff <fixed-point>...HEAD` and capture
     `git log <fixed-point>..HEAD --oneline`.
   - If the user asks for the current worktree, inspect `git status --short`
     and include staged, unstaged, and relevant untracked file content.
   - If the scope is ambiguous, ask for the fixed point or confirm that the
     worktree is the intended target. If the ref is bad or the scoped diff is
     empty, stop before launching subagents and report that.
2. Gather a compact context packet that both reviewers can use without
   guessing:
   - Exact diff command or worktree diff sources, plus the commit list or status
     summary.
   - Source request, issue, PRD, ticket plan, or spec. Look first in issue
     references from commit messages, then user-provided paths, then likely
     files under `docs/`, `specs/`, `.scratch/`, and branch-name-related plans.
     If none exists, mark the spec/request context as missing rather than
     inventing one.
   - Repo standards and instructions such as `AGENTS.md`, `CONTRIBUTING.md`,
     `CODING_STANDARDS.md`, `docs/agents/`, domain docs, or local equivalents.
     Tell reviewers to separate documented-standard violations from judgment
     calls.
3. Launch two independent subagents with the same scoped diff and context:
   - Use `$thermo-nuclear-review` for security, correctness, breaking-change,
     devex, and feature-gate issues.
   - Use `$thermo-nuclear-code-quality-review` for maintainability,
     abstraction, modularity, and code-quality issues.
4. Tell each subagent to return only prioritized findings with file references,
   evidence, and a clear "no findings" result if it finds nothing. Subagents
   must send their findings back to this parent review agent, not directly to
   the user.
5. Wait for both subagents. If a subagent fails or cannot run, say which review
   pass is missing and do not pretend its rubric was covered.
6. Verify medium and high priority findings against the repo before reporting
   them. Deduplicate overlapping findings, resolve conflicts with your own
   judgment, and avoid passing through raw subagent output wholesale.
7. Respond with findings first, ordered by severity and grounded in file and
   line references. Do not split the final report into separate Standards and
   Spec sections; synthesize one review from the Thermos passes. If there are no
   findings, say that clearly.
8. End with a brief coverage note: scope reviewed, Thermos passes completed or
   missing, whether spec/request context and standards were available, and any
   residual test or scope risk.

Do not invoke the top-level `$thermos` wrapper for this skill's normal path; it
runs the Thermos passes sequentially in the current agent. This review skill
should use the two underlying Thermos review skills in subagents.
