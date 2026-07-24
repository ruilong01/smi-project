import displayRecordsData from "../../data/processed/display-records.json" with { type: "json" };
import imageCandidatesData from "../../data/processed/image-candidates.json" with { type: "json" };
import researchEvaluationsData from "../../data/processed/research-evaluations.json" with { type: "json" };

/**
 * Research Intelligence Gallery data seam.
 *
 * Reads data/processed/display-records.json - NOT the full processed
 * records file (which holds every record, including pending/rejected
 * ones, and is admin/debug data only) - so this file, and everything built
 * on top of it (ResearchGallery, ResearchGalleryDetail, CountryProfile
 * Panel's gallery links), can only ever show records that already passed
 * the app's real-data display-eligibility rule (verified/source-linked
 * status, a real source URL, and at least one image candidate - see
 * scripts/processing/normalizeResearchRecord.mjs's isDisplayEligible()).
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
export const galleryRecords = (displayRecordsData.records ?? []).map((record) => ({
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

function namesMatch(a, b) {
  return Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Records don't carry an institution ID the way the legacy dataset does -
// only a coordinator name and (sometimes) an institutions[] array - so this
// matches on name, same as researchProjectData.js's getInstitutionSlugForName
// fallback for partner organisations.
export function getGalleryRecordsForInstitutionName(institutionName) {
  if (!institutionName) return [];
  return galleryRecords.filter((record) => {
    if (!record.images.length) return false;
    if (namesMatch(record.coordinator, institutionName)) return true;
    return (record.institutions ?? []).some((name) => namesMatch(name, institutionName));
  });
}

export function isGalleryRecordCoordinatedBy(record, institutionName) {
  return namesMatch(record.coordinator, institutionName);
}

// Normalizes a gallery (real-pipeline) record into the shape
// ResearchRecordCard expects - the same normalized card shape
// researchProjectData.js's toResearchRecordCardProps produces for legacy
// records, so country/institution pages can render both through one
// component without caring which dataset a given record came from.
export function toGalleryCardProps(record) {
  const image = record.images[0];
  return {
    id: record.recordId,
    href: `/research-gallery/${record.recordId}`,
    title: record.title,
    imageUrl: image?.imageUrl,
    imageAlt: image?.altText || image?.caption,
    imageCaption: image?.caption,
    topicName: record.topicPrimary,
    institutionLabel: record.coordinator || (record.institutions ?? [])[0] || "",
    provenanceLabel: getVerificationStatusLabel(record.verificationStatus),
    actionabilityScore: record.actionabilityScore,
  };
}

// Mirrors the five-way taxonomy scripts/processing/normalizeResearchRecord.mjs
// computes for every record. A source-linked seed record (real sourceUrl,
// no raw fetch file yet) must never be shown as fully verified automated
// data, and an unverified record must never be shown as a normal
// high-confidence one - these labels are the only place verificationStatus
// is turned into UI text, so there is one place to keep that rule correct.
const VERIFICATION_STATUS_LABELS = {
  verified_api_extracted: "Verified API-extracted record",
  source_linked_seed: "Source-linked seed record",
  metadata_only: "Metadata-only record",
  unverified: "Unverified record",
  mock_demo: "Mock/demo record",
};

export function getVerificationStatusLabel(verificationStatus) {
  return VERIFICATION_STATUS_LABELS[verificationStatus] ?? "Unverified record";
}
