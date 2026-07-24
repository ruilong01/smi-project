# In-App PDF Reader

## 1. What this is

A foundation for viewing an already-downloaded, legally open-access PDF
(see `docs/OPEN_ACCESS_PDF_INGESTION.md`) directly inside the app, next to
the research record it belongs to - instead of only linking out to an
external site. It reuses the OA-PDF ingestion pipeline already merged into
`main`; nothing here re-fetches or re-downloads anything.

## 2. Architecture

```
data/server/runtime/pdf-download-manifest.json  (existing, from discover:oa-pdfs)
                │
                ▼
scripts/processing/pdfAccessPolicy.mjs   -> serveInApp / allowUserDownload
scripts/processing/pdfRecordLinker.mjs   -> joins a display record to a manifest entry
                │
                ▼
server/server.mjs
  GET /api/research-records/:recordId/pdf-meta
  GET /api/research-records/:recordId/pdf
                │
                ▼
src/components/PdfViewer.jsx  (rendered on ResearchGalleryDetail.jsx)

scripts/ingestion/extractPdfText.mjs -> data/server/pdf-text/{paperId}.json
```

## 3. PDF access/licence policy (`scripts/processing/pdfAccessPolicy.mjs`)

`evaluatePdfAccessPolicy({ license, isOpenAccess, oaEvidence })` decides two
independent things from real, already-recorded OA metadata:

- **`serveInApp`** - safe to render inline in this app's own viewer?
- **`allowUserDownload`** - safe to also show an explicit "Download" link?

Rules (see the file for the exact patterns):

| Condition | serveInApp | allowUserDownload |
|---|---|---|
| No `isOpenAccess`/`oaEvidence` | false | false |
| License matches a restrictive/proprietary pattern | false | false |
| Known permissive license (CC-BY family, CC0, arXiv perpetual license) | true | true |
| Non-commercial license (CC-BY-NC family) | true | false |
| OA evidence exists but license is missing/unrecognized | true | false |

**Honest limitation**: this is an application-level policy, not a
technical access-control guarantee. A PDF rendered via a browser's native
viewer can still be saved by the user through that viewer's own UI -
`allowUserDownload: false` only means this app itself won't offer an
explicit download link, not that saving is technically prevented.

## 4. Preserving vs. deriving policy metadata

`discoverOpenAccessPdfs.mjs` now computes this policy at download time and
writes `doi`, `license`, `isOpenAccess`, `oaEvidence`, `serveInApp`,
`allowUserDownload`, `policyReason`, `policyVersion` onto every **new**
manifest entry - durable, because manifest entries are only ever appended
to, never rewritten.

PDFs downloaded **before** this feature existed have none of those fields.
`resolveOrDerivePolicy(entry)` handles both cases: if `serveInApp`/
`allowUserDownload` are already present, they're used as-is (preserved);
otherwise it derives a conservative policy from whatever fields the entry
does have, on the safe assumption that a manifest entry only exists
because `discoverOpenAccessPdfs.mjs`'s own legality gate already required
confirmed OA evidence before writing it (`isOpenAccess: true` is a real,
structural inference here, not a guess) - paired with no known license,
that means "viewable, download withheld pending review," the same
conservative default as an unrecognized license.

## 5. Linking a research record to a downloaded PDF

The OA-PDF pipeline and the display-records pipeline are independent by
design (the OA-PDF pipeline never writes into `research-records.json`).
`scripts/processing/pdfRecordLinker.mjs`'s `findLinkedPdfCandidate(record,
candidates)` joins them at **read time**: DOI equality first (normalized,
ignoring a `https://doi.org/` prefix and case), falling back to a
normalized `sourceUrl`/`sourceUrls[]` overlap. No stored foreign key, no
guessing - a real papers-in-common match, or nothing.

**Known current state**: today's downloaded PDFs (arXiv/Europe PMC papers
from the OA-PDF pipeline's own maritime topic sweep) don't share a DOI or
source URL with any of the 8 currently display-eligible records (CORDIS
project pages) - so `pdf-meta` correctly reports "unavailable" for all of
them right now. This is expected, not a bug: the linkage activates
automatically the moment `discover:oa-pdfs` downloads a paper whose DOI or
source URL matches an existing display record.

## 6. Backend routes (`server/server.mjs`)

- `GET /api/research-records/:recordId/pdf-meta` → `{ available, title,
  sourceName, license, allowUserDownload, policyReason }` or `{ available:
  false, reason }`. Never leaks a filesystem path.
- `GET /api/research-records/:recordId/pdf` → streams the PDF bytes
  (`Content-Type: application/pdf`, `Content-Disposition: inline`) only if
  `resolvePdfForRecord` finds a linked, policy-approved, on-disk file; 404
  otherwise.

**No arbitrary filesystem access**: `recordId` (the only client-supplied
input) is used purely as a lookup key into `display-records.json` and the
PDF manifest - never concatenated into a path. The manifest's own
`downloadedPath` is resolved against the repo root and then re-checked to
still fall under `data/server/pdfs/` before the filesystem is touched, and
`fs.existsSync` is checked before streaming. `verify:pdf-viewer-pipeline`
statically confirms all of this in the shipped source.

## 7. Frontend viewer (`src/components/PdfViewer.jsx`)

Rendered on `ResearchGalleryDetail.jsx` (the `/research-gallery/:recordId`
detail page). On mount, fetches `pdf-meta`; renders nothing if unavailable
(matches the existing "hide empty sections" convention - no clutter on
records without a linked PDF). If available, renders an `<iframe>` pointed
at the streaming route (the browser's own native PDF viewer - no added
rendering dependency) plus a "Download PDF" link, shown only when
`allowUserDownload` is true.

Needs the backend running (`npm run serve:api`) alongside the frontend dev
server (`npm run dev`); set `VITE_API_BASE_URL` if the API isn't at the
default `http://localhost:8787`.

## 8. Page-aware text extraction (`scripts/ingestion/extractPdfText.mjs`)

Uses `pdf-parse` (added as a new dependency - nothing pre-existing did
this) locally against already-downloaded PDFs; no network call, no AI.
Only extracts text for entries the access policy approves for in-app
serving (`serveInApp: true`) - there'd be nowhere to show text for a PDF
the policy withholds. Output: `data/server/pdf-text/{paperId-slug}.json`:

```json
{
  "paperId": "...", "title": "...", "sourceName": "...",
  "extractedAt": "...", "pageCount": 12, "pagesExtracted": 12,
  "truncated": false,
  "pages": [{ "page": 1, "text": "...", "charCount": 1234 }],
  "textExtractionStatus": "success"
}
```

Capped at 300 pages per PDF (`truncated: true` beyond that - a legitimate
paper is never this long). One corrupt/unreadable PDF is recorded as
`textExtractionStatus: "failed"` on its manifest entry and never stops the
run (CLAUDE.md rule 6). Also writes `textExtractionStatus`/`pdfTextPath`
back onto the manifest entry itself, so a later run (or the serving route)
never has to re-extract or re-derive it.

```bash
npm run extract:pdf-text -- --dry-run
npm run extract:pdf-text
npm run extract:pdf-text -- --paper-id "doi:10.xxxx/yyyy"
npm run extract:pdf-text -- --force
```

## 9. Verification

```bash
npm run verify:pdf-viewer-pipeline
```

Checks: `evaluatePdfAccessPolicy`/`resolveOrDerivePolicy`/
`findLinkedPdfCandidate` fixture cases (permissive/non-commercial/
restrictive/missing licenses; DOI match; sourceUrl match; no-match); `.gitignore`
still blocks `data/server/`; nothing under `data/server/` is tracked or
staged; every manifest entry claiming `textExtractionStatus: "success"`
has a real, well-formed extracted-text file on disk; and static checks on
`server.mjs`'s source confirming the `serveInApp` gate, the
`PDF_STORAGE_ROOT` containment check, the `fs.existsSync` check, and the
absence of any `recordId`/`identifier` used directly to build a
filesystem path.

## 10. What is not allowed / out of scope here

- No writes to `data/processed/research-records.json` or
  `display-records.json` - the record↔PDF join is read-time only.
- No PDF is ever served without `serveInApp: true` from real OA evidence.
- No arbitrary filesystem path is ever derived from client input.
- No AI is used anywhere in this feature - extraction is local text
  parsing, not analysis; a later task can run AI analysis on top of the
  extracted text, same "AI only after extraction" rule as the rest of
  this app.
- `data/server/`, downloaded PDFs, extracted text, `dist/`, `build/`, and
  any other generated runtime data stay out of git (`.gitignore` +
  `verify:git-clean-for-pr` both block `data/server/**`).
