# Open-Access PDF Ingestion

## 1. Why we start with free, open-access sources

Real maritime R&D papers are only useful in this app if they can be shown
to users legally and reliably. Rather than scraping restricted sites or
guessing at licensing, this pipeline only ever looks at sources that
publish structured, machine-readable evidence of legal open access (an
`is_oa` flag, a `best_oa_location`, an `openAccessPdf` field, an official
arXiv PDF link, etc.) - the same "extraction first, AI after" and
"source URL + timestamp on every record" rules the rest of this app
already follows (see `CLAUDE.md`). Starting here means every downloaded
PDF traces back to a specific, checkable piece of evidence
(`oaEvidence`), not an assumption.

## 2. Allowed sources

| Source | Role | Key required? |
|---|---|---|
| OpenAlex | Primary discovery (title, DOI, authorships, institutions, country, `open_access`, `best_oa_location`) | No |
| arXiv | Discovery - technical/AI/robotics/marine autonomy papers, official PDF only | No |
| Semantic Scholar | Discovery/cross-check via `openAccessPdf.url` | No (rate-limited without a key) |
| Europe PMC | Discovery - open-access subset only (`OPEN_ACCESS:Y` filter) | No |
| CORE | Discovery - repository-hosted OA full text | Yes (`CORE_API_KEY`) - **skipped entirely if unset** |
| Unpaywall | DOI-only legal-OA cross-check/enrichment, never standalone discovery | Needs an email (`UNPAYWALL_EMAIL` or `CONTACT_EMAIL`) - **skipped if unset** |
| OpenAIRE / CORDIS | Project/funding discovery (already used elsewhere - `globalSourceRegistry.mjs`, `discoverOfficialSources.mjs`) | No |

**Known limitation:** OpenAIRE/CORDIS are project-database sources, not
paper repositories - they don't currently produce direct PDF candidates
in this pipeline (their project pages are metadata/links, not papers with
their own OA PDF). Wiring them in would mean building a real per-project
publication-list fetch, which is future scope, not invented here.

## 3. Rejected sources

Never fetched, regardless of any open-access claim: **ResearchGate**,
**Academia.edu**, **Scribd**, **Sci-Hub**. Also rejected on sight: any
paywalled/login-required page, a bare DOI-redirect page with no PDF, a
publisher article page with no OA license/PDF, any response that is a
401/403/CAPTCHA, any response whose `content-type` isn't a PDF, any file
over the size cap, and any duplicate (by exact PDF URL or by sha256 of
the downloaded bytes).

## 4. Legal download rules

A candidate is only downloaded if it carries real, checkable OA evidence:

1. OpenAlex `open_access.is_oa = true` **and** a `pdf_url` is present.
2. Unpaywall returns a `best_oa_location.url_for_pdf`.
3. Semantic Scholar has `openAccessPdf.url`.
4. CORE returns a repository `downloadUrl`/`sourceFulltextUrls`.
5. Europe PMC's open-access subset provides an open `fullTextUrl`.
6. arXiv's own official PDF link.
7. An official university/institutional repository clearly hosting the PDF.

The evidence string is recorded verbatim as `oaEvidence` on every
candidate - never inferred, never assumed. No bypass of a login, CAPTCHA,
403, or anti-bot system is ever attempted; a blocked/failed fetch is
recorded as a rejection, not retried past that point (see `http.mjs`'s
retry policy - only 429/500/502/503/504 are retried, never 401/403/404).

## 5. How server storage works

Everything lives under `data/server/` (gitignored - see `.gitignore`,
created at runtime via `fs.mkdir(..., { recursive: true })`, same
convention as `data/processed/test/`):

```
data/server/raw/openalex/          (reserved for raw response caching)
data/server/raw/unpaywall/
data/server/raw/core/
data/server/pdfs/{source}/{year}/{slug}.pdf
data/server/staging/oa-pdf-candidates.json
data/server/runtime/pdf-download-manifest.json
data/server/runtime/oa-pdf-scan-status.json
data/server/logs/oa-pdf-ingestion.log
```

PDFs are never committed to git - they live on the deployed box's disk
only. `verify:git-clean-for-pr` blocks `data/server/**` from ever being
staged into a code PR.

## 6. How to run a dry run

```bash
npm run discover:oa-pdfs -- --dry-run --limit 30 --download-limit 0
```

Real network calls happen (same convention as `discoverResearchGlobal.mjs`)
so you can see what would be found, but **nothing is written to disk** -
no staging file, no manifest, no downloads, no log entries.

## 7. How to write staging (no downloads yet)

```bash
npm run discover:oa-pdfs -- --write-staging --limit 30 --download-limit 0
```

Writes `data/server/staging/oa-pdf-candidates.json` with every
candidate's full metadata, decision (`candidate`/`review`/`rejected`),
and reason - review this before downloading anything.

## 8. How to download (max 10 PDFs)

```bash
npm run discover:oa-pdfs -- --write-staging --download --limit 30 --download-limit 10
```

Downloads at most `--download-limit` PDFs (highest maritime-relevance
score first), one at a time (concurrency 1), with a ~1.2-1.6s jittered
delay between requests, a 20s timeout, and only 429/500/502/503/504
retried. Each PDF's `content-type` and size are checked before it's kept;
metadata (title, DOI, authors, institutions, countries, sourceUrl,
pdfUrl, license, `isOpenAccess`, `oaEvidence`, `downloadedPath`,
`sha256`, `fileSizeBytes`, `maritimeRelevanceScore`, `status`, etc.) is
written to the staging file and `data/server/runtime/pdf-download-manifest.json`.

Other useful flags: `--source openalex|arxiv|semantic-scholar|core|europe-pmc`
(restrict to one discovery source), `--topic "smart port"` (restrict to
one topic instead of the full ~26-term maritime topic list), `--country
Singapore` (OpenAlex institution-country filter only).

## 9. How to verify

```bash
npm run verify:oa-pdf-ingestion
```

Checks: production `research-records.json`/`display-records.json` were
never modified; `data/server/**` is gitignored and nothing from it is
tracked or staged; staging candidates exist (once `--write-staging` has
been run) and every rejected one has a `rejectionReason`; every
downloaded PDF has complete metadata (`sourceUrl`, `pdfUrl`,
`isOpenAccess: true`, `oaEvidence`, `sha256`, `fileSizeBytes`) and really
exists on disk at its recorded size; no ResearchGate/Academia.edu/Scribd/
Sci-Hub source was ever accepted; no PDF exceeds the 25MB cap; no sha256
appears twice in the download manifest.

## 10. How to run on AWS (Lightsail)

```bash
cd /opt/maritime-research
npm run discover:oa-pdfs -- --dry-run --limit 30 --download-limit 0
npm run discover:oa-pdfs -- --write-staging --limit 30 --download-limit 0
npm run discover:oa-pdfs -- --write-staging --download --limit 30 --download-limit 10
npm run verify:oa-pdf-ingestion
```

Set `CONTACT_EMAIL` (and optionally `UNPAYWALL_EMAIL`, `CORE_API_KEY`,
`SEMANTIC_SCHOLAR_API_KEY`, `OPENALEX_API_KEY`) in the server's own
`.env` - never in git. Sources needing a key that isn't set are skipped
cleanly (see `sourceAvailability` in the discovery report), never
guessed around. PDFs accumulate on the box's persistent disk at
`data/server/pdfs/` - not in the git checkout's tracked history.

## 11. How this connects to later AI analysis

This pipeline stops at staged, downloaded, source-proven PDFs with
`textExtractionStatus: "skipped"` (full-text extraction is deliberately
out of scope for this first pass - only sha256/file size are recorded
today). A later task can: extract text, run the same "AI only after
extraction" analysis this app already applies to other record types (see
`enrich:explanations`, `docs/IMAGE_FETCHING_AND_AI_EVALUATION.md`'s swap-
point pattern), and only then consider promoting a reviewed candidate
into `data/processed/research-records.json` via the existing
`process:records`/`compare:records` human-reviewed flow - never
automatically from this script.

## 12. What is not allowed

- No AI is used to fetch webpages or bypass access controls (`CLAUDE.md`
  rule #1) - every fetch here is a real HTTP GET against a documented,
  public API/endpoint.
- No ResearchGate, Academia.edu, Scribd, or Sci-Hub, ever, under any
  claimed OA status.
- No bypassing of a login wall, CAPTCHA, 403, or other anti-bot system.
- No downloading of paywalled content.
- No fake/invented records or evidence - every field traces back to a
  real API response.
- No writes to `data/processed/research-records.json` or
  `data/processed/display-records.json`.
- No scheduler (`schedulerInstalled: false` is asserted in
  `oa-pdf-scan-status.json`, matching `scanDailyResearch.mjs`'s pattern).
- No committing of downloaded PDFs or `data/server/**` runtime/staging
  output to git.
