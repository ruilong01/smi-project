---
name: frontend-qa
description: Verify frontend behavior after any UI change - routes, globe interaction, popups, layout, no page scrolling. Use after modifying anything in src/.
---

# Frontend QA

## Trigger
- Any change to files in src/ (components, pages, css, data layer)

## Workflow
1. `npm.cmd test -- --run` — all tests must pass.
2. `npm.cmd run build` — production build must pass.
3. `npm.cmd run dev` — load the app and verify:
   - Dashboard fills viewport, no page-level scrollbars
   - Globe renders, auto-rotates, drags smoothly, wheel-zooms over globe only
   - Rotation pauses on hover/drag/popup/panel, resumes after ~1.5s
   - Country shapes AND markers are clickable; tooltip on hover
   - Compact popup on click; full profile only via "View Full Profile"
   - All 6 topic routes open: green-shipping, smart-ports,
     autonomous-vessels, maritime-ai, alternative-fuels,
     maritime-cybersecurity
   - /sources/status renders source cards
   - Mock-data label visible: "Prototype demo data - source verification pending."
4. Check browser console for errors.

## Completion criteria
- Tests pass, build passes, all checklist items verified, zero console errors.

## Required report
1. Test/build results
2. Checklist items verified (list any that could not be verified and why)
3. Console errors found
4. Files changed since last QA
