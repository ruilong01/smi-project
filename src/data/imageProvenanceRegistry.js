import { galleryRecords } from "./researchGalleryData.js";

/**
 * Index of every real, image-backed gallery (real-pipeline) record, built
 * once at module load, keyed every way a main-journey (legacy) record
 * might reasonably need to look one up: by source URL, by DOI, and by
 * normalized title. researchImageMatcher.js is the only consumer - this
 * file just builds the lookup structures so that module can stay pure
 * matching logic.
 *
 * Only records that actually carry a real image are indexed - a gallery
 * record with no image has nothing to propagate.
 */

export function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeIdentifier(value) {
  return (value ?? "").toString().trim().toLowerCase();
}

const imageBackedRecords = galleryRecords.filter((record) => record.images?.length > 0);

export const bySourceUrl = new Map();
export const byDoi = new Map();
export const byNormalizedTitle = new Map();

imageBackedRecords.forEach((record) => {
  const sourceUrls = record.sourceUrls?.length ? record.sourceUrls : record.sourceUrl ? [record.sourceUrl] : [];
  sourceUrls.forEach((url) => {
    const key = normalizeIdentifier(url);
    if (key) bySourceUrl.set(key, record);
  });

  if (record.doi) {
    byDoi.set(normalizeIdentifier(record.doi), record);
  }

  const titleKey = normalizeTitle(record.title);
  if (titleKey) {
    if (!byNormalizedTitle.has(titleKey)) byNormalizedTitle.set(titleKey, []);
    byNormalizedTitle.get(titleKey).push(record);
  }
});

export function getImageBackedRecordCount() {
  return imageBackedRecords.length;
}
