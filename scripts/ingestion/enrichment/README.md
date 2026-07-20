# Parked: website-crawling enrichment pipeline

**Status: parked, not deleted.** Not called by the active MVP pipeline
(`npm.cmd run sync:data`) since the lean-MVP simplification. Every file
here is real, working code — kept for audit and to resume from later,
not experimental scaffolding.

Standalone entry points that still use this folder and still run:
`npm.cmd run enrich:sample` (writes to `data/raw/enrichment-runs/`,
see that folder's README) and `npm.cmd run verify:enrichment`.

## Files

**`extractWebpage.mjs`** — fetches a URL with a plain HTTP GET (no
JS execution) and parses it with cheerio into title/headings/
paragraphs/links/images. Worked reliably wherever a site didn't
block or require JS — the main limiting factor in practice.

**`extractWebpageBrowser.mjs`** — Playwright (headless Chromium)
fallback for pages that need JS to render. **Did not meaningfully
help**: tested against ScienceDirect and MDPI specifically, both
still blocked it (Cloudflare/Akamai-style fingerprint detection, not
simple rate limiting). Heaviest dependency in this folder (~300MB
browser binary) for the least proven value — the strongest candidate
for removal if this pipeline isn't resumed.

**`hostThrottle.mjs`** — enforces a minimum gap between requests to
the same hostname. Legitimate and lightweight; didn't change the
ScienceDirect/MDPI block outcome (confirmed by testing), but is
correct practice regardless.

**`resolveSourcePages.mjs`** — turns a project's OpenAlex metadata
(open-access URL, primary location, DOI) into candidate URLs to
visit, in priority order. Worked as designed.

**`chunkText.mjs`** — splits extracted paragraphs into short,
capped chunks (max 8 per page, 400 chars each) for the "short
snippets only" copyright rule. Worked as designed.

**`classifyEvidence.mjs`** — keyword-rule (not AI) classifier that
tags a chunk as technology/partner/result/location/maturity/impact/
other and generates a templated "why it matters" line. Worked as
designed; simple and cheap to keep.

**`schemaDefaults.mjs`** — default empty values for the
sourcePages/selectedEvidence/aiAnalysis/dataQuality fields. Trivial,
still used by the active `openalex.adapter.mjs` and
`manual.adapter.mjs` — **not fully parked**, still a live dependency.

## Real yield, for context

Across the one real end-to-end run (`data/raw/enrichment-runs/
china-sample-2026-07-20.json`): 10 candidates, 1 successful full
extraction (5 evidence snippets + 3 images, from a Frontiers
article), 9 failed (ScienceDirect/MDPI anti-bot blocks, one PDF
download, one JS-redirect-only page). Real, verified, not padded.

## Also parked (not in this folder)

- `scripts/ingestion/adapters/ror.adapter.mjs` — Research
  Organization Registry institution enrichment. Real working API
  integration, just not called by `runExtraction.mjs` right now.
- `scripts/ingestion/adapters/mpa.adapter.mjs` — fetches 2 real
  Singapore MPA government pages (uses `extractWebpage.mjs` above).
  Real working code, not called by `runExtraction.mjs` right now.

To resume any of this: re-add the import + `runSource(...)` block in
`scripts/ingestion/runExtraction.mjs` (see git history for the exact
prior wiring) and re-add the corresponding entry to
`src/data/sourceRegistry.js`'s `SOURCE_ADAPTER_META`.
