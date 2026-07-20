---
name: release-check
description: Full pre-release verification before committing a phase or pushing to GitHub. Use at the end of every phase or before any release.
---

# Release Check

## Trigger
- End of a phase
- Before any push/release
- User asks "is this ready?"

## Workflow
1. `git status` — no unintended modified files (node_modules, dist,
   package-lock only if dependencies genuinely changed).
2. `npm.cmd test -- --run` — all pass.
3. `npm.cmd run build` — passes; record bundle sizes.
4. Run the frontend-qa skill checklist in full.
5. Grep for secrets: no API keys, tokens, or .env contents in the diff.
6. Confirm mock-data labelling still present if mock data still in use.
7. Update GOAL TRACKER statuses in CLAUDE.md for completed items.
8. Draft the commit message(s): small, scoped, imperative.

## Completion criteria
- All checks pass; goal tracker updated; commit message drafted.
- NOTHING is pushed — pushing is manual by the developer.

## Required report
1. Check-by-check results
2. Bundle size vs previous release
3. Goal tracker before/after
4. Proposed commit message(s)
5. Anything intentionally deferred
