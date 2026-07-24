// The legacy dataset (src/data/generated/liveResearchData.json) and the
// real pipeline (data/processed/display-records.json, via
// researchGalleryData.js) both ingested some of the same underlying source
// records independently (e.g. the same CORDIS project) - so combining
// "image-ready legacy projects" + "gallery matches" for one country or
// institution can show the identical record twice. Dedupes by normalized
// title, keeping whichever card came first - callers should list the
// gallery (real-pipeline) cards first so that version wins, since it is
// the more strictly display-eligibility-gated one.
export function dedupeRecordCardsByTitle(cards) {
  const seen = new Set();
  return cards.filter((card) => {
    const key = (card.title || "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
