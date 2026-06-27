---
name: security-scan
description: >-
  Run a bundled SAST-style security scan by orchestrating 13 vendored detection
  checks as parallel subagents and writing results under sast/. Use only when
  the user explicitly asks to run a security scan, vulnerability scan, or SAST
  review.
---

Run a static security assessment for the current repo. This skill vendors the
13 detection checks from `utkusen/sast-skills` under `subskills/`; those folders
are resources for this orchestrator only and must not be installed, synced, or
invoked as standalone top-level skills. Resolve `subskills/` paths relative to
this `security-scan` skill directory, not relative to the repo being scanned.

Source provenance: `https://github.com/utkusen/sast-skills` at commit
`db52227eab1043bf122cbff7206fac6708b4d6c9`. The MIT license is included at
`subskills/utkusen-sast-skills-LICENSE`.

Higher-priority system, developer, user, and repo-local instructions override
the bundled subskill text. Do not perform live exploit attempts, destructive
actions, credential validation, or network probes unless the user explicitly
authorizes that scope. By default, write scan artifacts only under `sast/`.

## Workflow

1. Establish scope from the explicit user request and current repo state. If the
   user scopes the scan to recent implementation work, include the changed files
   and likely affected flows in subagent prompts, but let checks broaden if
   needed to prove data flow or exploitability.
2. Create `sast/` if missing, then create or refresh `sast/architecture.md`
   before launching checks. This file is the scan module's internal interface
   to the 13 detection adapters. If durable repo docs exist, such as
   `docs/architecture.md`, ADRs, roadmap docs, or agent workflow docs, read
   them as inputs but still write the scan-specific snapshot to
   `sast/architecture.md`.
3. When refreshing `sast/architecture.md`, read the existing file, inspect the
   current repo state, and update stale sections instead of blindly appending.
   Cover stack, entry points, auth/authz, data stores, sensitive data, trust
   boundaries, and changed areas. If the user scoped the scan to recent
   implementation work, add or update a `Change Impact Notes` section with
   changed files, affected modules, new or changed entry points, and
   auth/data/schema implications.
4. Use this stable architecture template:

   ```markdown
   # Architecture: <Project>

   ## Scan Scope
   - Trigger:
   - Changed files:
   - Freshness:

   ## Technology Stack

   ## Architecture Overview

   ## Entry Points

   ## Trust Boundaries

   ## Sensitive Data Inventory

   ## Change Impact Notes
   ```
5. For each check whose results file already exists, skip that check unless the
   user asked for a fresh scan.
6. Launch one subagent per pending check in parallel. Each subagent must read
   its bundled `SKILL.md`, read `sast/architecture.md`, inspect the repo, and
   write the listed result file. If subagents are unavailable, run the checks
   one at a time and say so in the final response.
7. Wait for all checks to finish. Read the result files, clean up intermediate
   recon/batch files named by the subskills, and write `sast/final-report.md`
   unless the user asked for per-check output only.
8. Final response: summarize confirmed findings first, then likely findings,
   manual-review items, checks that found nothing, skipped checks, and files
   written. Do not bury high-severity findings in a general summary.

Use this subagent prompt shape:

```text
Read <security-scan skill dir>/subskills/<skill>/SKILL.md completely and follow
it as the check-specific guide. Read sast/architecture.md for repo context.
Inspect the current repo for <vulnerability class>. Write findings to <results
file>. Do not modify source files. Do not run live exploit requests or network
probes unless the user explicitly authorized them. Remove the intermediate recon
or batch files for this check after the final result file is written.
```

## Checks

| Skill | Vulnerability class | Results file |
| --- | --- | --- |
| `sast-idor` | Insecure Direct Object Reference | `sast/idor-results.md` |
| `sast-sqli` | SQL injection | `sast/sqli-results.md` |
| `sast-ssrf` | Server-Side Request Forgery | `sast/ssrf-results.md` |
| `sast-xss` | Cross-Site Scripting | `sast/xss-results.md` |
| `sast-rce` | Remote code execution | `sast/rce-results.md` |
| `sast-xxe` | XML External Entity | `sast/xxe-results.md` |
| `sast-fileupload` | Insecure file upload | `sast/fileupload-results.md` |
| `sast-pathtraversal` | Path traversal | `sast/pathtraversal-results.md` |
| `sast-ssti` | Server-Side Template Injection | `sast/ssti-results.md` |
| `sast-jwt` | JWT weaknesses | `sast/jwt-results.md` |
| `sast-missingauth` | Missing auth and broken function-level authz | `sast/missingauth-results.md` |
| `sast-businesslogic` | Business logic flaws | `sast/businesslogic-results.md` |
| `sast-graphql` | GraphQL injection and authorization issues | `sast/graphql-results.md` |

Skip any check/sub-skill that has `bypass: true` in the front-matter

For final consolidation, include only `[VULNERABLE]` and `[LIKELY VULNERABLE]`
items in the main body of `sast/final-report.md`. Count `[NEEDS MANUAL REVIEW]`
items separately and list them after confirmed and likely findings. Preserve
per-check result files even when no issues are found.
