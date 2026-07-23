// Single shared normalization layer for data/processed/research-records.json.
//
// Two independent pipelines write records into that same file:
//   - scripts/ingestion/ingestMediaSeed.mjs   (CORDIS seed records, source-
//     linked but not produced by the automated fetch pipeline)
//   - scripts/ingestion/processRecords.mjs    (OpenAlex API-fetched records,
//     full raw-file provenance)
// Before this module existed those two scripts used incompatible field
// names and a different notion of "verified", which is why
// verify:data-provenance used to report the media-seed records as 100%
// unverified even though every one of them has a real, checkable source
// URL. Every record now passes through normalizeResearchRecord() before it
// is written or read, so there is exactly one record shape and exactly one
// place that decides what "verified" means.
//
// normalizeResearchRecord() accepts a record in ANY of these input shapes
// and returns the same normalized shape either way:
//   - the raw seed JSON's own snake_case fields (record_id, source_url,
//     topic_primary, topic_secondary, evidence_snippet, why_useful,
//     actionability_score, relevance_score, ...)
//   - ingestMediaSeed.mjs's existing camelCase output (recordId, sourceUrl,
//     topicPrimary, evidenceSnippet, whyUseful, actionabilityScore, ...)
//   - processRecords.mjs's AWS/API-fetched shape (recordId, sourceUrls[],
//     doi, openAlexUrl, rawSourceFiles[], verificationStatus,
//     fieldProvenance, dataOrigin, ...)
//
// It is intentionally a pure function operating on ONE record at a time
// (no file I/O, no dataset-wide joins) so it is trivial to unit-test - see
// scripts/processing/verifySchemaCompatibility.mjs.

// No \b word-boundary here deliberately: dataStatus/recordType values are
// our own snake_case tokens (e.g. "mock_demo_sample"), and \b never matches
// between two underscore-joined words since "_" counts as \w.
const MOCK_PATTERN = /mock|demo|sample/i;

export const VERIFICATION_STATUSES = [
  "verified_api_extracted",
  "source_linked_seed",
  "metadata_only",
  "unverified",
  "mock_demo",
];

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

function uniqueStrings(values) {
  return [...new Set(values.filter((v) => typeof v === "string" && v.length > 0))];
}

function toNumberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Decides the ONE verificationStatus for a record from its actual evidence,
// never from whatever status a source pipeline happened to write - this is
// what stops the two pipelines from disagreeing about what "verified" means.
//
//   verified_api_extracted - has a raw fetch file AND real source evidence
//                            (sourceUrls / openAlexUrl / doi). Produced only
//                            by the automated fetch pipeline.
//   source_linked_seed     - has a real sourceUrl/sourceUrls but no raw
//                            fetch file yet (e.g. the CORDIS media-seed
//                            records). Traceable, just not automated yet.
//   metadata_only          - has an openAlexUrl/doi but no source page URL.
//   unverified             - no usable sourceUrl, doi, openAlexUrl or raw
//                            fetch file at all.
//   mock_demo              - explicitly flagged mock/demo/sample data.
function classifyVerificationStatus({ rawSourceFiles, sourceUrls, openAlexUrl, doi, isMock }) {
  if (isMock) return "mock_demo";

  const hasRawFile = rawSourceFiles.length > 0;
  const hasSourceUrls = sourceUrls.length > 0;
  const hasOpenAlexOrDoi = Boolean(openAlexUrl) || Boolean(doi);

  if (hasRawFile && (hasSourceUrls || hasOpenAlexOrDoi)) return "verified_api_extracted";
  if (hasSourceUrls) return "source_linked_seed";
  if (hasOpenAlexOrDoi) return "metadata_only";
  return "unverified";
}

function inferDataOrigin(rawSourceFiles, sourceUrls, explicitOrigin) {
  if (explicitOrigin) return explicitOrigin;
  if (rawSourceFiles.length > 0) return "api_extracted";
  if (sourceUrls.length > 0) return "manual_seed";
  return "unknown";
}

function inferFieldProvenance(raw, { hasImages, countryCode, coordinator, summary }) {
  if (raw.fieldProvenance && typeof raw.fieldProvenance === "object") {
    return raw.fieldProvenance;
  }
  return {
    title: raw.title ? "source" : "missing",
    summary: summary ? "source" : "missing",
    image: hasImages ? "source_candidate" : "missing",
    country: countryCode ? "source" : "missing",
    institution: coordinator ? "source" : "missing",
  };
}

export function normalizeResearchRecord(raw, { nowIso = new Date().toISOString() } = {}) {
  if (!raw || typeof raw !== "object") {
    throw new TypeError("normalizeResearchRecord: raw record must be an object");
  }

  const recordId = firstDefined(raw.recordId, raw.record_id, raw.id) ?? "";
  const title = firstDefined(raw.title) ?? "";
  const acronym = firstDefined(raw.acronym) ?? "";
  const sourceDatabase = firstDefined(raw.sourceDatabase, raw.source_database) ?? "";

  const sourceUrls = uniqueStrings([
    ...toArray(firstDefined(raw.sourceUrls, raw.source_urls)),
    ...toArray(firstDefined(raw.sourceUrl, raw.source_url)),
  ]);
  const sourceUrl = sourceUrls[0] ?? "";

  const doi = firstDefined(raw.doi) ?? "";
  const openAlexUrl = firstDefined(raw.openAlexUrl, raw.openalex_url) ?? "";
  const rawSourceFiles = uniqueStrings(toArray(firstDefined(raw.rawSourceFiles, raw.raw_source_files)));

  const countryOrRegion = firstDefined(raw.countryOrRegion, raw.country_or_region) ?? "";
  const countryCode = firstDefined(raw.countryCode, raw.country_code) ?? "";
  const institutions = uniqueStrings(toArray(firstDefined(raw.institutions, raw.institution)));
  const coordinator = firstDefined(raw.coordinator, raw.institution) ?? "";

  const topicPrimary = firstDefined(raw.topicPrimary, raw.topic_primary) ?? "";
  const topicSecondary = firstDefined(raw.topicSecondary, raw.topic_secondary) ?? "";
  const topics = uniqueStrings([topicPrimary, topicSecondary, ...toArray(raw.topics)]);

  const summary = firstDefined(raw.summary) ?? "";
  const whyUseful = firstDefined(raw.whyUseful, raw.why_useful) ?? "";
  const evidenceSnippet = firstDefined(raw.evidenceSnippet, raw.evidence_snippet) ?? "";

  const plainLanguageExplanation = firstDefined(raw.plainLanguageExplanation, summary) ?? "";
  const problemBeingAddressed = firstDefined(raw.problemBeingAddressed, evidenceSnippet) ?? "";
  const technologyApproach = firstDefined(raw.technologyApproach, whyUseful) ?? "";
  const maritimeRelevance = firstDefined(raw.maritimeRelevance) ?? "";
  const possibleApplication = firstDefined(raw.possibleApplication) ?? "";
  const whyItMatters = firstDefined(raw.whyItMatters, whyUseful) ?? "";
  const limitations = firstDefined(raw.limitations) ?? "";

  const actionabilityScore = toNumberOrNull(firstDefined(raw.actionabilityScore, raw.actionability_score));
  const relevanceScore = toNumberOrNull(firstDefined(raw.relevanceScore, raw.relevance_score));
  const sourceQualityScore = toNumberOrNull(
    firstDefined(
      raw.sourceQualityScore,
      raw.source_quality_score,
      (raw.sourceQuality ?? raw.source_quality) === "official_project_page" ? 85 : undefined
    )
  );

  const recencyCategory = firstDefined(raw.recencyCategory, raw.recency_category) ?? "";
  const followUpStatus = firstDefined(raw.followUpStatus, raw.follow_up_status) ?? "";
  const dataStatus = firstDefined(raw.dataStatus, raw.data_status) ?? "";

  const images = toArray(raw.images);
  const imageIds = uniqueStrings(toArray(firstDefined(raw.imageIds, raw.image_ids)));
  const imageCandidateCount =
    toNumberOrNull(firstDefined(raw.imageCandidateCount, raw.image_candidate_count)) ??
    Math.max(images.length, imageIds.length);
  const hasImageCandidates = Boolean(
    firstDefined(raw.hasImageCandidates, raw.has_image_candidates, imageCandidateCount > 0)
  );

  const isMock =
    raw.dataOrigin === "mock_demo" ||
    raw.dataOrigin === "mock" ||
    raw.verificationStatus === "mock_demo" ||
    MOCK_PATTERN.test(String(dataStatus ?? "")) ||
    MOCK_PATTERN.test(String(raw.recordType ?? ""));

  const verificationStatus = classifyVerificationStatus({
    rawSourceFiles,
    sourceUrls,
    openAlexUrl,
    doi,
    isMock,
  });

  const dataOrigin = inferDataOrigin(rawSourceFiles, sourceUrls, raw.dataOrigin);

  const fieldProvenance = inferFieldProvenance(raw, {
    hasImages: hasImageCandidates,
    countryCode,
    coordinator,
    summary,
  });

  const dataQualityFlags = uniqueStrings([
    ...toArray(raw.dataQualityFlags),
    !summary && !plainLanguageExplanation ? "missing_summary" : null,
    !countryCode ? "missing_country" : null,
    !hasImageCandidates ? "missing_image_candidates" : null,
    verificationStatus === "unverified" ? "no_source_evidence" : null,
  ]);

  return {
    // Preserve any field not explicitly re-mapped below (e.g. sourceType,
    // sourceQuality, abstract, categories, technologies, matchedQuery,
    // countryName, crossrefVerified, publicationDate...) - this is the
    // safeguard against silently stripping fields the two source pipelines
    // still rely on but that aren't part of the shared canonical shape.
    ...raw,

    recordId,
    recordType: firstDefined(raw.recordType, "funded_project") ?? "",
    title,
    acronym,
    sourceDatabase,
    sourceUrls,
    sourceUrl,
    doi,
    openAlexUrl,
    rawSourceFiles,
    countryOrRegion,
    countryCode,
    institutions,
    coordinator,
    topicPrimary,
    topicSecondary,
    topics,
    summary,
    whyUseful,
    evidenceSnippet,
    plainLanguageExplanation,
    problemBeingAddressed,
    technologyApproach,
    maritimeRelevance,
    possibleApplication,
    whyItMatters,
    limitations,
    actionabilityScore,
    relevanceScore,
    sourceQualityScore,
    recencyCategory,
    followUpStatus,
    dataStatus,
    verificationStatus,
    dataOrigin,
    images,
    imageIds,
    hasImageCandidates,
    imageCandidateCount,
    fieldProvenance,
    dataQualityFlags,
    extractedAt: firstDefined(raw.extractedAt, raw.extracted_at, nowIso) ?? nowIso,
    processedAt: nowIso,
  };
}
