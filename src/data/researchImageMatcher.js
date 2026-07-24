import { bySourceUrl, byDoi, byNormalizedTitle, normalizeTitle, normalizeIdentifier } from "./imageProvenanceRegistry.js";

/**
 * Finds a real, already-verified image from the Research Gallery pipeline
 * (data/processed/display-records.json) that clearly belongs to a given
 * main-journey (country/institution/legacy-project) record, so the SAME
 * image can be reused on country/institution/research-detail pages instead
 * of those pages only ever showing their own, separately-tracked image (or
 * none).
 *
 * Strict priority order - stops at the first rule that produces an
 * UNAMBIGUOUS match:
 *   1. Exact sourceUrl match
 *   2. Exact DOI match
 *   3. Exact normalized title match (only if exactly one gallery record has it)
 *   4. Normalized title + country (narrows an ambiguous title match)
 *   5. Normalized title + institution (narrows an ambiguous title match)
 *   6. No safe match -> null. An uncertain match is never guessed; a
 *      missing image is always safer than a wrong one attached to the
 *      wrong record.
 */

function buildResult(record, method, confidence, reason) {
  const image = record.images[0];
  return {
    imageUrl: image.imageUrl,
    imageSourceUrl: image.sourceUrl || record.sourceUrl || "",
    imageSourceName: image.sourceName || record.sourceDatabase || "",
    rightsNote: image.rightsNote || "Rights not verified; use as linked preview only.",
    imageMatchMethod: method,
    imageMatchConfidence: confidence,
    imageProvenanceReason: reason,
    matchedGalleryRecordId: record.recordId,
  };
}

/**
 * @param {object} query
 * @param {string} [query.sourceUrl] - a single source URL for the record
 * @param {string[]} [query.sourceUrls] - all known source URLs, if more than one
 * @param {string} [query.doi]
 * @param {string} query.title
 * @param {string} [query.country] - country name or ISO code, whichever the record carries
 * @param {string} [query.institution] - lead/coordinator institution name
 * @returns {object|null} the propagated-image shape, or null if no safe match exists
 */
export function findPropagatedImage({ sourceUrl, sourceUrls, doi, title, country, institution } = {}) {
  const urls = sourceUrls?.length ? sourceUrls : sourceUrl ? [sourceUrl] : [];
  for (const url of urls) {
    const key = normalizeIdentifier(url);
    if (!key) continue;
    const match = bySourceUrl.get(key);
    if (match) return buildResult(match, "source_url", "high", `Exact sourceUrl match: ${url}`);
  }

  if (doi) {
    const match = byDoi.get(normalizeIdentifier(doi));
    if (match) return buildResult(match, "doi", "high", `Exact DOI match: ${doi}`);
  }

  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) return null;
  const titleMatches = byNormalizedTitle.get(normalizedTitle) ?? [];
  if (titleMatches.length === 0) return null;

  if (titleMatches.length === 1) {
    return buildResult(titleMatches[0], "title", "high", `Exact normalized title match: "${normalizedTitle}"`);
  }

  if (country) {
    const countryKey = normalizeIdentifier(country);
    const countryMatches = titleMatches.filter(
      (record) => normalizeIdentifier(record.countryCode) === countryKey || normalizeIdentifier(record.countryOrRegion).includes(countryKey)
    );
    if (countryMatches.length === 1) {
      return buildResult(countryMatches[0], "title_country", "medium", `Title + country match: "${normalizedTitle}" / ${country}`);
    }
  }

  if (institution) {
    const institutionKey = normalizeIdentifier(institution);
    const institutionMatches = titleMatches.filter(
      (record) =>
        normalizeIdentifier(record.coordinator) === institutionKey ||
        (record.institutions ?? []).some((name) => normalizeIdentifier(name) === institutionKey)
    );
    if (institutionMatches.length === 1) {
      return buildResult(institutionMatches[0], "title_institution", "medium", `Title + institution match: "${normalizedTitle}" / ${institution}`);
    }
  }

  // Multiple gallery records share this exact title with no disambiguating
  // signal available - genuinely ambiguous, not a rule 6 "conservative
  // fuzzy match" case (this codebase has no fuzzy-title matching; exact
  // normalization is as far as it goes). Refuse rather than guess.
  return null;
}
