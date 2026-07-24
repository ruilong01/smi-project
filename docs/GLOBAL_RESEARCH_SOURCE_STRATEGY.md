# Global Research Source Strategy

## Purpose

Before the discovery pipeline queries or fetches ANY external source, it
needs to know two things about that source: is it real/documented (not
invented), and how much should a result from it be trusted. This document
covers both: the **source registry** (what providers exist and how they
may be accessed) and the **credibility classifier** (given a URL, how
much to trust it and whether it's safe to fetch).

This is distinct from `src/data/sourceRegistry.js`, which documents
provenance metadata for records the app has ALREADY extracted (a
per-record admin display concern). The registry here is upstream of that -
it's the pipeline's own map of what it's allowed to go looking in.

## The source registry

`scripts/ingestion/globalSourceRegistry.mjs` exports
`GLOBAL_SOURCE_REGISTRY` - a real, hand-authored catalog. Every entry:

```js
{
  sourceId: "openalex",
  sourceName: "OpenAlex",
  sourceType: "structured-api",
  baseUrl: "https://api.openalex.org",
  officialDocsUrl: "https://docs.openalex.org",
  accessType: "public-api",       // public-api | public-website | license-required | restricted
  requiresApiKey: false,
  requiresLicense: false,
  rateLimitNotes: "...",
  dataTypes: ["publications", "authorships", "institutions"],
  credibilityTier: "high",        // high | medium | low
  credibilityReason: "...",
  enabled: true,
}
```

`verify:source-registry` enforces one hard rule beyond field completeness:
**a source with `accessType: "license-required"` or `"restricted"` can
never be `enabled: true`** - this pipeline must never silently start
treating a paywalled or restricted source as something it can just fetch.

### Sources included today

| sourceId | Type | Access | Enabled | Notes |
|---|---|---|---|---|
| `openalex` | structured-api | public-api | ✅ | Primary source for this app's real extracted records |
| `crossref` | structured-api | public-api | ✅ | DOI verification |
| `cordis` | official-project-database | public-website | ✅ | EU-funded project pages |
| `openaire` | structured-api | public-api | ✅ | Real XML API, confirmed working (see discoverOfficialSources.mjs) |
| `ror` | structured-api | public-api | ❌ (parked) | Not yet called - listed for future institution-identity resolution |
| `government-funding-page` | official-government-page | public-website | ✅ | Generic .gov/.europa.eu category (e.g. MPA Singapore) |
| `university-project-page` | official-institution-page | public-website | ✅ | Generic .edu/.ac.xx category |
| `wikimedia-commons` | media-repository | public-website | ✅ | Images only, license metadata required |
| `wikipedia-wikidata` | discovery-only | public-website | ✅ | Never a final source, only a discovery pointer |
| `doi-resolver` | redirect-only | restricted | ❌ | Never fetched for content, just a real identifier |
| `academic-publisher` | paywalled-publisher | license-required | ❌ | Metadata via OpenAlex/Crossref instead; page itself blocked |
| `stock-photo-site` | stock-media | restricted | ❌ | Never a legitimate source; kept as a real reject test case |

## The credibility classifier

`scripts/processing/sourceCredibilityClassifier.mjs` exports
`classifySourceCredibility(url)` -> `{ credibilityTier, accessType,
matchedSourceId, reason }`. It:

1. Checks the URL's hostname directly against the registry's `baseUrl`
   entries (openalex.org, crossref.org, cordis.europa.eu, etc.).
2. Falls back to `classifyImageSourceUrl` (already built and tested in
   the image-fetching work) for URL-shape categories not directly in the
   registry - government/funding keywords, `.edu`/`.ac.xx` institution
   domains, known publisher hostnames, DOI redirects - mapping each
   category onto a credibility tier/access type. This is deliberate reuse,
   not a second implementation of the same domain patterns.
3. Defaults unrecognized domains to `low` credibility / `needs-review`
   access - never assumes an unknown domain is trustworthy just because
   nothing marks it as bad.

`verify:source-credibility` runs a fixture of 9 real, known URLs (OpenAlex,
Crossref, CORDIS, a real .gov.sg page, a real .edu.sg page, doi.org, a
known publisher, a known stock-photo site, and a malformed URL) and
asserts the exact expected tier/access for each - the same adversarial-
fixture pattern already used for the image classifiers in this codebase.

## How this feeds the discovery pipeline

`discoverResearchGlobal.mjs` (Phase 2) stamps every candidate with the
credibility classification of its `sourceUrl`, so a human reviewing the
staging output can immediately see whether a candidate came from a
`high`-tier public API or an unrecognized domain that needs a closer
look - without that classification ever gating what gets discovered
(discovery still finds everything a real OpenAlex search returns;
credibility is metadata for the reviewer, not a silent filter, in this
first pass).
