# Deep Search Design

## What "deep search" means here

A flat topic search (`discoverResearchGlobal.mjs`'s default mode) tries
one search term per pass. "Deep search" instead combines, for ONE
country+topic pair:

1. **Several real query variants** on the same theme, not just the bare
   topic term - e.g. for Singapore + "smart port": `"smart port"`,
   `"smart port Singapore"`, `"smart port digital twin"`, `"smart port
   automation"`, `"Singapore port technology research"`.
2. **Known official reference pages** for that country/topic, cited
   directly (not re-discovered by guessing) - for Singapore, the two real
   `MPA_SOURCES` URLs already defined in `scripts/ingestion/config.mjs`
   (Singapore's Maritime and Port Authority innovation/R&D pages).
3. **Source credibility tagging** on every result via
   `classifySourceCredibility` (Phase 1), so a reviewer can immediately
   see which results came from a high-credibility public API vs an
   unrecognized domain.

This is a genuinely different (deeper) research pass than a single flat
search, without inventing anything: every query variant is a real OpenAlex
search, every official reference is a real, already-used URL, and
duplicates against production data are still checked exactly the same way
`discoverResearchGlobal.mjs` does.

## Why Singapore + smart port

Both are already real, populated parts of this app's data (Singapore is
one of the 24 active countries; "Smart Ports" is one of the 6 curated
topic pages), and `MPA_SOURCES` already exists as a real, curated official
source for Singapore - making this the lowest-risk possible pair to prove
the deep-search mechanism end to end before generalizing it.

## Implementation

`scripts/ingestion/deepSearchSample.mjs` reuses
`discoverResearchGlobal.mjs`'s exact `fetchWorksPage`/`buildCandidate`/
`normalizeUrl`/`normalizeTitle` functions (exported for this purpose, not
duplicated) - the same OpenAlex call, same country-authorship-attribution
fix, same credibility stamping, same dedup-against-production logic.
Output goes only to `data/processed/test/deep-search-sample.json`
(staging, gitignored) - `--dry-run` skips even that write.

```bash
npm run deep-search:sample -- --dry-run --country Singapore --topic "smart port"
npm run deep-search:sample -- --country Singapore --topic "smart port" --limit 15
```

CLI options: `--country` (default Singapore), `--topic` (default "smart
port"), `--limit` (default 15), `--dry-run`.

## Known limitation

The official-reference list (`MPA_SOURCES`) is currently only populated
for Singapore - for any other `--country`, `officialReferences` is
correctly empty rather than guessed. Extending this to more countries
means adding their own real, curated official source URLs first (the same
review this app already did for Singapore), not inventing a pattern to
find them automatically.

## Verification

`npm run verify:deep-search-sample` checks the staging output exists,
every candidate has title+sourceUrl, every official reference has a real
http(s) URL and a credibility classification, and that production
research data was never touched.
