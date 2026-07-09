---
name: repo-audit
description: Audit the repository structure, builds, routes, data flow and performance without changing code. Use when starting work after a gap, before a new phase, or when asked to "audit" or "review the repo".
---

# Repository Audit

## Trigger
- Beginning a new phase of work
- Returning to the project after other work
- User asks for an audit, health check, or current-state review

## Workflow
1. `git status` and `git log --oneline -5` — confirm clean state and HEAD.
2. Read package.json scripts and dependency list.
3. List `src/` and `scripts/`; note any new/removed files vs CLAUDE.md.
4. Run `npm.cmd test -- --run` and `npm.cmd run build`; record results.
5. Check the GOAL TRACKER in CLAUDE.md against actual code state.
6. Verify all routes listed in CLAUDE.md still exist in src/App.jsx.
7. Check bundle output size from the build log.

## Rules
- READ-ONLY. Do not modify any file during an audit.

## Completion criteria
- Tests and build both executed with recorded results.
- Every GOAL TRACKER row checked and status confirmed or corrected.

## Required report
1. Build/test results (pass/fail, bundle size)
2. Goal tracker rows whose real status differs from CLAUDE.md
3. New risks discovered
4. Recommended next task
