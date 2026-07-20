# Raw enrichment run archive

This folder holds the raw output of enrichment vertical-slice runs — real
network fetches (OpenAlex, Crossref, and original source pages), not
fabricated data. Kept for audit and as input for future enrichment work,
separate from the app's active (processed) dataset.

## china-sample-2026-07-20.json

Produced by `npm.cmd run enrich:sample` (see
`scripts/ingestion/enrichSample.mjs`, currently parked — see
`scripts/ingestion/enrichment/README.md`).

**What it is:** 10 China maritime R&D candidates (from OpenAlex metadata
already in the live dataset — OpenAlex's own live API was rate-limited
during this run), each with a resolved source URL, a real fetch attempt
against that URL, and — where the fetch succeeded — extracted evidence
snippets and image candidates.

**What worked:** 1 of 10 source pages yielded real content (a Frontiers
journal article on alternative marine fuels): 5 real evidence snippets
(quoted text, classified by type) and 3 real image URLs with captions.
That one project's data is merged into the live dataset
(`src/data/generated/liveResearchData.json`) and shown in the app.

**What didn't work:** 9 of 10 — ScienceDirect and MDPI block both plain
HTTP fetches and headless-browser (Playwright) fetches outright
(fingerprint-based anti-bot, not simple rate limiting — confirmed by
testing both paths). See the file's own `meta` block for exact counts
(`sourcePagesFetchedSuccessfully`, `sourcePagesFailed`, etc.).

**Provenance, not fabrication:** every record here traces to a real
API call or a real HTTP fetch attempt, logged with `fetchedAt`
timestamps. Failed attempts are recorded as failures, not silently
dropped or padded with placeholder content.
