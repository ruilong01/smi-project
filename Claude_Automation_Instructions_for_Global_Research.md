# Claude Operating Instructions — Global Maritime R&D Dataset Expansion

## Current seed files

Use these as the new media-enabled seed data:

- `maritime_rnd_records_with_image_candidates.json`
- `maritime_rnd_records_with_image_candidates.csv`
- `maritime_rnd_image_candidates.csv`
- `global_research_automation_queue.json`

## Main idea

Do not randomly rewrite the UI. Build a controlled, verifiable data loop:

1. Read the global research queue.
2. Pick a small batch of tasks.
3. Search/fetch metadata from structured sources first.
4. Add records to `data/processed/research-records.json`.
5. For selected high-value records only, find official project/institution pages and image candidates.
6. Store media candidates as URL + caption + source + rights note.
7. Update country profiles.
8. Verify numbers.
9. Display in app.

## Required npm commands to add

```powershell
npm.cmd run ingest:media-seed
npm.cmd run queue:next
npm.cmd run fetch:queue-batch
npm.cmd run process:records
npm.cmd run build:country-profiles
npm.cmd run verify:data-quality
npm.cmd run build
```

## File targets

```text
data/raw/
data/raw/openalex/
data/raw/crossref/
data/raw/media-candidates/
data/processed/research-records.json
data/processed/country-profiles.json
data/processed/image-candidates.json
data/processed/global-research-queue-status.json
data/processed/data-quality-report.json
```

## Image rules

- Do not download images by default.
- Do not claim image rights.
- Store image candidates only:
  - imageUrl
  - caption
  - altText
  - sourceUrl
  - sourceName
  - imageType
  - canEmbed=false by default
  - rightsNote
- Frontend should show a linked preview card.
- If an image fails to load, show source card instead.
- If rights are uncertain, do not embed as final official image.

## Dataset rules

- Raw collection: 2015-present.
- Default app view: 2020-present.
- Latest highlight: 2024-present.
- No extracted records = coverage pending, not no research.
- Do not show old/archive records at top.
- Sort by: actionabilityScore desc, recencyScore desc, relevanceScore desc, year desc.

## First Claude task

Paste this into Claude Code:

```text
Use the media-enabled seed dataset.

Input files:
- maritime_rnd_records_with_image_candidates.json
- maritime_rnd_image_candidates.csv
- global_research_automation_queue.json

Task:
1. Copy or import these files into the project under data/seed/.
2. Create npm.cmd run ingest:media-seed.
3. Convert seed records into data/processed/research-records.json.
4. Convert image candidates into data/processed/image-candidates.json.
5. Update country profiles from the processed records.
6. Update the app panel to show image/source preview cards when a record has images[].
7. If no image exists, show "Image candidate not available yet" and keep the source link visible.
8. Do not fake images.
9. Do not download images.
10. Run npm.cmd run build and report result.

Acceptance proof:
- record count
- records with image candidates
- image candidate count
- processed output file paths
- frontend component changed
- npm.cmd run build result
```

## Automation loop after seed ingestion

```text
Run only 10-25 queue tasks per batch.

For each queue task:
1. Use OpenAlex/Crossref/DataCite first.
2. Keep 2015-present raw range.
3. Filter default records to 2020-present.
4. Add only useful maritime R&D records.
5. For top 3 high-actionability records in the batch, search official/institution/project pages for images.
6. Save image candidates, not downloaded images.
7. Update processed files.
8. Verify data quality.
```

## Acceptance report every time

Claude must report:

1. Queue tasks completed
2. New records added
3. Duplicate records skipped
4. Records with source URLs
5. Records with image candidates
6. Countries updated
7. Top topics updated
8. Files changed
9. Commands run
10. Build result
11. Remaining failures
