---
name: data-connector
description: Build or fix a data source connector in scripts/ingestion (OpenAlex, Crossref, ROR, MPA, RSS, new sources). Use for extraction failures or adding sources toward the 500-record target.
---

# Data Connector

## Trigger
- Extraction failures (403s, timeouts, empty results)
- Adding a new open source (API, RSS, government portal, university page)
- Working goal tracker items 1 or 8

## Rules (non-negotiable)
- No AI for fetching. Public APIs / RSS / HTTP extraction only.
- Every record: source URL + fetched timestamp. No exceptions.
- Retry with exponential backoff; polite User-Agent with contact email;
  delay between requests (>=1s APIs, >=2s websites).
- One failed source must not stop the pipeline: catch per source,
  log to extractionRuns with parseErrors, continue.
- Deduplicate: DOI first, then normalised title + country.
- Respect robots.txt and site terms for webpage extraction.

## Workflow
1. Reproduce the failure or define the new source's endpoint/format.
2. Write/repair the adapter in scripts/ingestion/adapters/.
3. Run `npm.cmd run sync:data`; inspect the generated JSON:
   counts, source status, parseErrors, spot-check 3 records for
   valid sourceUrl + retrievedAt.
4. Confirm the frontend still renders: `npm.cmd run dev`, check the map
   and /sources/status.
5. Run `npm.cmd test -- --run`.

## Completion criteria
- Sync completes; failed sources logged but do not abort the run
- Records include source URL + timestamps; duplicates removed
- Tests pass; /sources/status reflects real run results

## Required report
1. Sources attempted, records fetched/created/rejected per source
2. Errors encountered and how they are surfaced in source status
3. Dedup results
4. Goal tracker rows to update
