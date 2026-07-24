# Global Data and Image Expansion Plan

## Why current data is not enough

The app's real data today covers 24 countries, 381 detected institutions,
and 329 processed records - but only 8 records are actually
display-eligible (real image-backed) and only 5 of 381 institutions had a
real image before this step. Most of the world's maritime research
activity, and most of the institutions already named in the data, are
invisible to a normal user. Two things needed to scale together:

1. **Coverage** - the app needs to recognize far more countries/
   institutions/records than it happens to have today, without faking any
   of them.
2. **Image quality** - a bare logo is a weak visual identity for an
   institution; a real landmark/campus photo is far more useful and is
   worth actively searching for, not settling for the first image found.

This plan builds the five-stage pipeline (registry -> flags -> institution
detection -> landmark images -> research discovery) as **reusable,
incremental, source-proven mechanisms** - never a one-time manual edit,
and never fake data standing in for coverage that doesn't exist yet.

## Pipeline overview

```
1. discover research records  (discover:research:global, staging only)
2. detect countries            (build:country-registry)
3. fetch country flags         (fetch:country-flags)
4. detect institutions         (build:institution-registry)
5. fetch institution images    (discover:institution-images, landmark-first)
6. run mock AI evaluator       (mockImageRelevanceEvaluator.mjs, every candidate)
7. promote accepted images/data (manual, reviewed - see below)
8. frontend shows flag + institution image + research records + analysis
```

Steps 2-5 are implemented and tested this pass. Step 1 (research
discovery) is implemented as a staging-only candidate generator; steps
7-8's *promotion* remains manual and reviewed, by design (see "What
remains manual review" below).

## How the 117-country expansion works

`scripts/ingestion/countrySeedList.mjs` is a real, hand-authored ISO
3166-1 reference list (171 countries - comfortably past the ~117 target),
each with `iso2`/`iso3`/`region`/`subregion`. `scripts/ingestion/
buildCountryRegistry.mjs` merges this against the app's actual current
research data (`src/data/generated/liveResearchData.json`): a country is
only ever `enabled`/`dataStatus: "active"` because real research records
already exist for it. A seed-list country with no records yet gets
`dataStatus: "no-data"` - never a faked "active" status. Output:
`src/data/generated/countryRegistry.json`, consumed by the frontend via
`src/data/countryRegistry.js`.

## How countries are detected

Country detection today is: the seed list is the exhaustive reference
(what countries COULD exist), and `liveResearchData.json`'s existing
extracted country list is what's ACTUALLY populated. A new country
"appears" the moment a real extracted record puts it into that data (this
already happens via the existing, unmodified extraction pipeline - Step 1
of this plan doesn't change how records get extracted, only how the
registry reflects what's there). Running `discover:research:global`
against a new country and later promoting its candidates into the real
pipeline is how a `no-data`/`pending` country becomes `active`.

## How flags are fetched

`scripts/ingestion/fetchCountryFlags.mjs` reads
`countryRegistry.json` (not a hardcoded list) and fetches a real SVG per
ISO2 code from flagcdn.com. `--all` sweeps every registry country (~170
today); the default sweeps only `enabled` ones. `--missing-only` narrows
to whatever doesn't already have a local file. Metadata merges into the
existing registry file across runs (a narrow run never erases a broader
run's earlier entries). `CountryFlagBadge.jsx` prefers the local
`/assets/flags/{iso2}.svg` asset, falling back to an emoji, falling back
to a globe icon - no remote flag request ever happens from the browser.

## How institutions are detected

`scripts/ingestion/buildInstitutionRegistry.mjs` walks every legacy
project's `leadOrganisation`/`partnerOrganisations` and every real-pipeline
gallery record's `coordinator`/`institutions[]`, normalizing each name
(case/punctuation-insensitive) and merging by EXACT normalized-name match
only. Two institutions that are probably the same organisation but don't
normalize identically (e.g. "SINTEF Ocean" vs "SINTEF OCEAN AS") are kept
as separate entries - merging on similarity alone risks silently
conflating two different institutions, which this plan explicitly refuses
to do. An alias is only recorded when the SAME normalized name is seen
under two different exact spellings. Output: `src/data/generated/
institutionRegistry.json`, with `recordCount`/`sourceRecords` computed
from real project attribution, never invented.

## How institution landmark images are fetched

`scripts/ingestion/discoverInstitutionImages.mjs` reads institutions from
the registry, resolves a homepage from either the registry's own
`officialWebsite` field (populated for only 1 of 381 institutions today)
or a small, explicit `KNOWN_OFFICIAL_DOMAINS` seed map (10 institutions) -
never a guessed/invented URL. It fetches the homepage plus up to 4 guessed
common sub-pages (about/about-us/campus/media, capped at 5 pages total per
the safety limit), extracts every og:image/twitter:image/schema.org logo
or image/inline `<img>` with a relevant keyword/favicon candidate from
EVERY page fetched, scores all of them with the mock evaluator, and picks
the single best one by **image type priority first, score second**:
landmark-building > campus > hero > wikimedia > logo > fallback. This is
what let NTU's entry upgrade from a plain logo to a real photo of The
Hive (one of its actual landmark buildings), found on its `/about-us` page
- the sample script that preceded this one only ever tried the homepage
and settled for whatever it found there.

Known limitation: only 12 institutions (1 with a real registry website +
10 known-domain overrides, with 1 overlap) can be searched at all today
without inventing a URL; a JS-rendered homepage (confirmed for National
University of Singapore) yields no extractable image via a plain HTML
fetch, since this app does not run a headless browser for ingestion.

## How research records are discovered

`scripts/ingestion/discoverResearchGlobal.mjs` runs real OpenAlex API
searches across a 21-term maritime/marine/port/ocean topic list (default
run: first 6 terms, small per-term page size), optionally filtered to one
country (`--country`) or a small batch of not-yet-active registry
countries (`--missing-countries-only --countries N`). Every candidate
requires a real title and a real http(s) sourceUrl; abstracts are
reconstructed from OpenAlex's inverted-index format (its standard way of
returning abstract text within copyright constraints), never generated.
Candidates are deduplicated against the real production
`research-records.json` by exact sourceUrl or exact normalized title
before being written - **only to
`data/processed/test/research-discovery-candidates.json` (staging,
gitignored)**, never to the production files.

A real bug was found and fixed while testing this: when a country filter
is used, OpenAlex only guarantees ONE authorship matches it, so blindly
reading `authorships[0]` (the first author) frequently attributed a
record to a co-author's country instead of the filtered one. Fixed to
search authorships for the one actually matching the requested country.

## How mock AI evaluation works

`scripts/processing/mockImageRelevanceEvaluator.mjs`, upgraded this pass
with an explicit `classifyImageType()` step (landmark-building/campus/
hero/wikimedia/logo/fallback) and per-type score bonuses (landmark +0.32,
campus +0.26, hero +0.14, logo +0.04) so a real campus/building photo
scores meaningfully higher than a logo even from the identical official
domain - see `docs/IMAGE_FETCHING_AND_AI_EVALUATION.md` for the full
scoring rules and hard-reject list. Still MOCK ONLY - deterministic rules,
no model call, no API key.

## How the real AI API will replace mock AI later

Unchanged from the original plan (see `docs/IMAGE_FETCHING_AND_AI_EVALUATION.md`
section 4): the swap point is the single `evaluateImageRelevance()` call
site in each discovery script. A real AI call must return the same
`{ decision, score, imageType, reasons, risks }` shape, must never invent
an image URL or approve an unrelated/unsourced image, and must always cite
which source page justified its decision.

## What remains manual review

- **Promoting a research candidate** from `data/processed/test/
  research-discovery-candidates.json` into the real pipeline is not
  automated by this step - it still goes through the existing `process:
  records`/`compare:records` flow, which already has its own safe-write
  and verification gates.
- **Promoting an institution image** into `src/data/
  institutionImageRegistry.js` is a manual copy-and-review step (see
  `docs/IMAGE_FETCHING_AND_AI_EVALUATION.md`'s promotion workflow) - a
  "review"-band or lower-confidence "accept" is never auto-promoted.
- **Expanding `KNOWN_OFFICIAL_DOMAINS`** to cover more institutions
  requires a human to confirm each new domain really is that
  institution's own site - this plan deliberately does not attempt to
  guess or search for one.
- **Full 117-country / all-institution runs** are intentionally NOT run
  by this step - every command here defaults to a small batch
  (`--limit`/`--countries`/registry-`enabled`-only), consistent with
  "test in controlled batches first, then allow expansion."
