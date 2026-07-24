# Image Fetching and AI Evaluation

## 1. Overview

This is a feasibility test for fetching real, source-linked images
(national flags, institution images) and evaluating whether a candidate
image is relevant enough to use - all without a real AI API, since one
isn't available yet. A deterministic **mock evaluator** stands in for the
future AI, using the same input/output contract, so swapping it out later
is a one-function change, not a redesign.

Pipeline shape:

```
discover candidates (og:image / schema.org / inline <img>)
        |
        v
mock/real evaluator  ->  { decision, score, reasons, risks }
        |
        v
accept -> download (size/type/timeout limits) -> write provenance record
reject -> write provenance record (no download)
```

## 2. Components

| File | Role |
|---|---|
| `src/data/imageProvenanceRegistry.js` | Indexes every image-backed Research Gallery record by sourceUrl/DOI/normalized title |
| `src/data/researchImageMatcher.js` | Strict priority-order matcher: finds a safe, unambiguous image match for a main-journey record, or returns `null` |
| `scripts/processing/mockImageRelevanceEvaluator.mjs` | **MOCK ONLY** - deterministic accept/reject/review scoring, described in detail below |
| `scripts/ingestion/fetchCountryFlags.mjs` | Fetches real flag SVGs from flagcdn.com for countries in current app data |
| `scripts/ingestion/discoverInstitutionImagesSample.mjs` | Sample institution-image discovery + download, using the mock evaluator |

## 3. The mock evaluator (today)

`scripts/processing/mockImageRelevanceEvaluator.mjs` exports
`evaluateImageRelevance(input)`. It is **MOCK ONLY - replace with real AI
API later.** Every decision traces to an explicit, inspectable rule - no
model call, no invented judgement.

Input:

```json
{
  "targetType": "institution | research-record",
  "targetName": "...",
  "country": "...",
  "candidateImageUrl": "...",
  "imageSourceUrl": "...",
  "imageAlt": "...",
  "imageTitle": "...",
  "pageTitle": "...",
  "sourceDomain": "...",
  "fetchMethod": "og:image | twitter:image | schema:logo | schema:image | link:icon | page:img | wikimedia"
}
```

Output:

```json
{
  "decision": "accept | reject | review",
  "score": 0.0,
  "reasons": ["..."],
  "risks": ["..."],
  "futureAiPromptCompatible": true
}
```

Hard rejects (short-circuit, score forced to 0, regardless of any other
signal): no source page URL, non-http(s) URL, base64 data URL, a source
page that classifies as a DOI redirect/PDF/publisher article (reuses the
existing `classifyImageSourceUrl` from `scripts/processing/
imageSourceClassifier.mjs`, unchanged), a known stock-photo domain, a
social-media domain with no official link, a search-thumbnail/tracking-
pixel/favicon path pattern, or a generic-icon path pattern.

Everything else is scored additively (domain-name/acronym match to the
target, `fetchMethod` quality, official-asset path keywords, alt/title/
page-title mentioning the target) and classified: **≥0.75 accept, 0.40-
0.74 review, <0.40 reject**.

Known limitation: there is no real image-dimension check (no image-
decoding library is installed) - `discoverInstitutionImagesSample.mjs`
uses a content-length floor (1KB) as a stand-in for "too small to be a
real photo/logo," not actual pixel width/height.

## 4. Swapping in the real AI API later

The swap point is exactly one function. Anywhere `evaluateImageRelevance()`
is called (currently only in `discoverInstitutionImagesSample.mjs`),
replace the call with one to the real API, keeping the same input shape in
and the same `{ decision, score, reasons, risks }` shape out. Nothing else
in the pipeline needs to change - the download/provenance/rejection-
recording logic only cares about that output shape, not how it was
produced.

### Future AI prompt template

```
You are evaluating whether a candidate image may represent a maritime
research institution or research record. You are NOT allowed to invent
image URLs, invent rights information, or approve an image you cannot
justify from the given evidence.

Given:
- target: { targetType, targetName, country }
- source page URL: {imageSourceUrl}
- candidate image URL: {candidateImageUrl}
- page title: {pageTitle}
- image alt/title text: {imageAlt} / {imageTitle}
- source domain: {sourceDomain}
- fetch method: {fetchMethod}

Decide:
1. Is this image official / clearly source-related to the target (not a
   random search result, stock photo, or unrelated page)?
2. Does it visually plausibly represent the institution/research record
   (a logo, a real campus/building photo, a project visual) rather than
   generic/decorative content?
3. Reject anything random, generic, or unrelated - do not guess in the
   target's favor.
4. Explain your decision in plain language.
5. Return STRICT JSON ONLY, matching the schema below - no prose outside
   the JSON.
```

### Strict output JSON schema

```json
{
  "type": "object",
  "required": ["decision", "score", "reasons", "risks", "futureAiPromptCompatible"],
  "properties": {
    "decision": { "type": "string", "enum": ["accept", "reject", "review"] },
    "score": { "type": "number", "minimum": 0, "maximum": 1 },
    "reasons": { "type": "array", "items": { "type": "string" } },
    "risks": { "type": "array", "items": { "type": "string" } },
    "futureAiPromptCompatible": { "type": "boolean", "const": true }
  },
  "additionalProperties": false
}
```

The future AI must NOT: invent image URLs, invent rights/license
information, approve a random or unrelated image, or approve any image
that lacks a source URL. Any of those should be a `reject`, not an
`accept` with a caveat.

## 5. Image propagation (reusing Research Gallery images elsewhere)

`src/data/researchImageMatcher.js`'s `findPropagatedImage(query)` finds a
real, already-verified Research Gallery image for a country/institution/
research-detail record that doesn't have its own, using this strict
priority order - it returns `null` rather than guessing when a match is
ambiguous:

1. Exact `sourceUrl` match
2. Exact DOI match
3. Exact normalized-title match (only if exactly one gallery record has it)
4. Normalized title + country (disambiguates a title shared by >1 record)
5. Normalized title + institution (same)
6. No safe match found -> `null`

Every successful match returns full provenance: `imageUrl`,
`imageSourceUrl`, `imageSourceName`, `rightsNote`, `imageMatchMethod`,
`imageMatchConfidence`, `imageProvenanceReason`.

## 6. Verification

- `npm.cmd run verify:image-propagation` - matcher/registry logic, run against real data
- `npm.cmd run verify:country-flags` - flag assets + metadata + CountryFlagBadge wiring
- `npm.cmd run verify:institution-image-sample` - sample discovery output + downloaded files
- `npm.cmd run verify:institution-images-in-ui` - promoted registry + UI wiring (see below)

## 7. Promoting accepted images into UI

`discover:institution-images:sample`'s output
(`data/processed/test/institution-image-sample.json`, and the images it
downloads under `public/assets/test/institutions/`) is **test/runtime
data** - regenerated every run, gitignored, and never read by the app
directly. It exists to let a human review what the mock evaluator
accepted before anything reaches production users.

Promoting a reviewed, accepted image into the real UI is a **manual,
deliberate step**, not something any script does automatically:

1. Run the sample discovery (`npm.cmd run discover:institution-images:sample`,
   optionally `-- --dry-run` first) and read the accepted entries in
   `data/processed/test/institution-image-sample.json`.
2. Copy the approved image file from `public/assets/test/institutions/{slug}/image.{ext}`
   to the stable path `public/assets/institutions/{slug}/image.{ext}`.
3. Add one entry to `src/data/institutionImageRegistry.js` - copied
   verbatim from the sample's accepted record (never invented), with
   `assetPath` pointing at the new stable path and `rightsNote` written as
   a conservative statement (e.g. "Source-proven official website image;
   verify usage rights before commercial redistribution.") rather than a
   claim of cleared rights.
4. Run `npm.cmd run verify:institution-images-in-ui` and
   `npm.cmd run verify:institution-image-sample`.
5. Run `npm.cmd run build`.

`InstitutionHeader.jsx` reads only `institutionImageRegistry.js`, matching
by exact slug or exact normalized institution name - never fuzzy, and
never falling back to `public/assets/test/`. An institution with no
registry entry always shows the honest "Institution image pending source
verification" state, never a guessed or unrelated image.
