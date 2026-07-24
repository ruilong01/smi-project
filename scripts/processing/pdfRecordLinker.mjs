// Joins a research record (data/processed/display-records.json /
// research-records.json shape - has `doi`, `sourceUrl`, `sourceUrls[]`) to
// a downloaded open-access PDF (data/server/runtime/pdf-download-manifest.json
// entry - has `doi` when known, `sourceUrl`, `paperId`). The two pipelines
// are independent by design (see docs/OPEN_ACCESS_PDF_INGESTION.md - the OA
// PDF pipeline never writes into research-records.json), so this is a
// read-time match, never a stored foreign key: DOI equality first (the
// stronger signal), falling back to sourceUrl overlap against the record's
// sourceUrl/sourceUrls.

export function normalizeDoi(doi) {
  if (!doi) return null;
  return doi
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/\/$/, "");
}

export function normalizeUrl(url) {
  if (!url) return null;
  return url
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
}

/**
 * @param {object} record - a display-records.json/research-records.json record
 * @param {Array<object>} candidates - manifest download entries (or staging candidates), each with doi?/sourceUrl/paperId
 * @returns {object|null} the matching candidate, or null if none
 */
export function findLinkedPdfCandidate(record, candidates) {
  if (!record || !Array.isArray(candidates) || candidates.length === 0) return null;

  const recordDoi = normalizeDoi(record.doi);
  if (recordDoi) {
    const byDoi = candidates.find((c) => normalizeDoi(c.doi) === recordDoi);
    if (byDoi) return byDoi;
  }

  const recordUrls = new Set(
    [record.sourceUrl, ...(Array.isArray(record.sourceUrls) ? record.sourceUrls : [])].filter(Boolean).map(normalizeUrl)
  );
  if (recordUrls.size === 0) return null;

  return candidates.find((c) => {
    const candidateUrl = normalizeUrl(c.sourceUrl);
    return candidateUrl && recordUrls.has(candidateUrl);
  }) ?? null;
}
