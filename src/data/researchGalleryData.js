import researchRecordsData from "../../data/processed/research-records.json";
import imageCandidatesData from "../../data/processed/image-candidates.json";
import researchEvaluationsData from "../../data/processed/research-evaluations.json";

/**
 * Research Intelligence Gallery data seam.
 *
 * Reads data/processed/research-records.json directly (all real,
 * source-backed maritime R&D records - not gated on whether a record
 * could be attributed to a single country, unlike the legacy per-country
 * project pipeline in researchProjectData.js). Joins in image candidates
 * and heuristic/AI explanations by recordId.
 *
 * Same build-time-import seam as researchProjectData.js's
 * loadResearchData() - a future runtime-fetch swap only touches this file.
 */

// Mirrors scripts/ingestion/aiCuration/verdict.mjs - kept in sync manually
// since this runs in the browser, not Node. Only an explicit "assessed"
// verdict of unsuitable/needs_review/low-score hides an image; "pending"
// (not curated yet) and "error" always stay visible.
const AI_CURATION_MIN_SCORE = 60;
function shouldHideImage(aiCuration) {
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

const imagesByRecordId = new Map();
(imageCandidatesData.images ?? []).forEach((image) => {
  if (shouldHideImage(image.aiCuration)) return;
  if (!imagesByRecordId.has(image.recordId)) imagesByRecordId.set(image.recordId, []);
  imagesByRecordId.get(image.recordId).push(image);
});

const evaluationsByRecordId = new Map(
  (researchEvaluationsData.evaluations ?? []).map((evaluation) => [evaluation.recordId, evaluation])
);

// Every record gets `images` (possibly empty - never faked) and
// `evaluation` (null if this record hasn't been enriched yet). A record
// with no evaluation is real, sourced metadata that just hasn't had
// explanation fields generated for it - shown plainly, not hidden.
export const galleryRecords = (researchRecordsData.records ?? []).map((record) => ({
  ...record,
  images: imagesByRecordId.get(record.recordId) ?? [],
  evaluation: evaluationsByRecordId.get(record.recordId) ?? null,
}));

// Enriched-first ordering: records with a real explanation and/or image
// surface first in the gallery, since those are the ones actually ready to
// show management - the rest are still real but metadata-only.
export const enrichedGalleryRecords = galleryRecords
  .filter((record) => record.evaluation || record.images.length > 0)
  .sort((a, b) => (b.actionabilityScore ?? 0) - (a.actionabilityScore ?? 0));

export function getGalleryRecordById(recordId) {
  return galleryRecords.find((record) => record.recordId === recordId) ?? null;
}

export function getGalleryRecordsForCountryCode(countryCode) {
  if (!countryCode) return [];
  return galleryRecords.filter((record) => record.countryCode === countryCode);
}
