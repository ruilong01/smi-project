---
name: globe-performance
description: Measure and improve WorldMap.jsx globe rendering performance. Use when FPS drops, drag feels laggy, or when working goal tracker items 2-4.
---

# Globe Performance

## Trigger
- Working on goal tracker items 2, 3 or 4
- Reported lag, drag ghosting, or FPS below 30 on a normal laptop

## Constraints (from project brief)
- KEEP the 50m atlas. Do not downgrade to 110m. Performance must come from
  back-face culling, memoised path caching, and reduced compositing cost.
- One rAF loop only; refs for rotation/zoom; no 60fps React state updates;
  never rebuild geometry per frame.

## Workflow
1. Baseline: record DevTools Performance profile during 5s of drag +
   5s of auto-rotation. Note scripting/rendering/painting ms per frame.
2. Apply ONE change at a time (culling, path caching, blur reduction).
3. Re-profile after each change; keep only changes that measurably help.
4. Smoke-test interactions: drag, zoom, popup open/close, marker clicks,
   country shape clicks, keyboard activation.
5. Run frontend-qa skill before finishing.

## Completion criteria
- >=30 FPS sustained during drag and auto-rotation on the dev machine
- No interaction regressions (verified via frontend-qa checklist)

## Required report
1. Before/after frame timings
2. Each optimisation applied and its measured effect
3. Any optimisation tried and rejected, with reason
4. Goal tracker rows to update
