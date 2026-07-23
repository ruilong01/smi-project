import { AI_CURATION_MIN_SCORE } from "./config.mjs";

// Shared by curateImages.mjs (applies verdicts to the legacy dataset after
// assessing) and ingestMediaSeed.mjs (must not resurrect a previously
// hidden image just because the seed was re-ingested). Single source of
// truth for "does this verdict mean hide the image" so the two scripts
// can never disagree with each other.
//
// Never hides on "pending" (not assessed yet) or "error" (API hiccup) -
// only an explicit "unsuitable"/"needs_review" verdict, or a real
// below-threshold score, hides an image.
export function shouldHideImage(aiCuration) {
  if (!aiCuration || aiCuration.status !== "assessed") {
    return false;
  }
  if (aiCuration.verdict === "unsuitable" || aiCuration.verdict === "needs_review") {
    return true;
  }
  if (aiCuration.score !== null && aiCuration.score !== undefined && aiCuration.score < AI_CURATION_MIN_SCORE) {
    return true;
  }
  return false;
}
