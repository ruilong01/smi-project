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
//
// Also decides displayEligible/displayEligibilityReasons/processingStatus -
// the gate scripts/ingestion/triageRecords.mjs uses to split every record
// into data/processed/display-records.json (shown in the app),
// pending-image-enrichment.json (real, but no image yet) or
// rejected-records.json (mock/demo/unverified). A record is eligible only
// with real source evidence AND at least one image candidate - the app
// must never show a real-looking record with no verifiable image.

import { createHash } from "node:crypto";

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

// verificationStatus values a record must have to ever be shown in the
// app. "metadata_only" (our actual classifier output, assigned only when
// sourceUrls is empty) is deliberately NOT in this set - such a record is
// always also caught by missing_source_url below, but must never be
// admitted by verificationStatus alone if that ever changes.
const DISPLAY_ELIGIBLE_VERIFICATION_STATUSES = new Set([
  "verified_api_extracted",
  "source_linked_seed",
  "metadata_only_with_source",
]);

// A record already staged for later handling (rejected/archived/pending-
// image/needs-review) must never be admitted just because its other
// fields happen to look eligible.
const PROCESSING_STATUS_BLOCKLIST = new Set([
  "rejected",
  "archived",
  "pending_image_enrichment",
  "needs_manual_review",
]);

const DATA_ORIGIN_BLOCKLIST = new Set(["mock_demo", "unknown", "ai_generated_only"]);

// The ONE gate deciding whether a record is allowed to appear in the main
// app - see scripts/ingestion/processRecords.mjs, which partitions every
// record into display-records.json / pending-image-enrichment.json /
// rejected-records.json based on this function's result. Real evidence
// (source URL + a verified-eligible status) AND at least one real image
// candidate are BOTH required; a record failing either one is never shown.
export function isDisplayEligible(record) {
  const reasons = [];

  if (!record.recordId) reasons.push("missing_record_id");
  if (!record.title) reasons.push("missing_title");

  if (record.verificationStatus === "mock_demo") {
    reasons.push("mock_demo_record");
  } else if (record.verificationStatus === "unverified") {
    reasons.push("unverified_record");
  } else if (!DISPLAY_ELIGIBLE_VERIFICATION_STATUSES.has(record.verificationStatus)) {
    // Any other value (metadata_only, or an unrecognised status) is
    // conservatively treated the same as unverified - never silently
    // admitted just because it isn't one of the two explicit bad values.
    reasons.push("unverified_record");
  }

  if (!(record.sourceUrls?.length > 0)) {
    reasons.push("missing_source_url");
  }

  if (!record.hasImageCandidates || !((record.imageCandidateCount ?? 0) > 0)) {
    reasons.push("missing_image_candidate");
  }

  if (record.processingStatus && PROCESSING_STATUS_BLOCKLIST.has(record.processingStatus)) {
    if (record.processingStatus === "rejected") reasons.push("rejected_record");
    else if (record.processingStatus === "archived") reasons.push("archived_record");
    else reasons.push(record.processingStatus); // pending_image_enrichment / needs_manual_review
  }

  if (record.dataOrigin && DATA_ORIGIN_BLOCKLIST.has(record.dataOrigin)) {
    reasons.push("unknown_data_origin");
  }

  return { displayEligible: reasons.length === 0, displayEligibilityReasons: [...new Set(reasons)] };
}

// Backward-compatible alias - normalizeResearchRecord() below still needs
// to compute a processingStatus BEFORE isDisplayEligible can run (the
// function above treats an already-rejected/pending processingStatus as an
// input, not an output), so the initial classification happens here.
function classifyProcessingStatus({ verificationStatus, sourceUrls, hasImageCandidates, imageCandidateCount }) {
  if (verificationStatus === "mock_demo" || verificationStatus === "unverified") {
    return "rejected";
  }
  const hasSourceUrl = sourceUrls?.length > 0;
  const hasImage = hasImageCandidates && (imageCandidateCount ?? 0) > 0;
  if (hasSourceUrl && hasImage) return "accepted";
  return "pending_image_enrichment";
}

function computeRecencyScore(record) {
  if (record.recencyScore != null) return record.recencyScore;
  const dateValue = record.publicationDate || record.extractedAt || record.processedAt;
  const parsed = dateValue ? new Date(dateValue) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return 0;
  const ageYears = (Date.now() - parsed.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.max(0, Math.round(100 - ageYears * 10));
}

// Content hash used by scripts/ingestion/compareRecords.mjs to skip
// re-enriching a record whose actual content hasn't changed since the last
// refresh. Deliberately excludes extractedAt/processedAt/lastSeenAt/
// lastUpdatedAt themselves - those change every run regardless of content,
// which would make the hash useless for detecting real changes.
export function computeRecordHash(record) {
  const basis = JSON.stringify({
    title: record.title,
    summary: record.summary,
    evidenceSnippet: record.evidenceSnippet,
    sourceUrls: [...(record.sourceUrls ?? [])].sort(),
    doi: record.doi,
    countryCode: record.countryCode,
    imageUrls: (record.images ?? []).map((image) => image.imageUrl).sort(),
    imageIds: [...(record.imageIds ?? [])].sort(),
    startDate: record.startDate ?? null,
    endDate: record.endDate ?? null,
    totalCostEur: record.totalCostEur ?? null,
  });
  return createHash("sha256").update(basis).digest("hex").slice(0, 24);
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

  const processingStatus = classifyProcessingStatus({
    verificationStatus,
    sourceUrls,
    hasImageCandidates,
    imageCandidateCount,
  });

  const recencyScore = computeRecencyScore({ ...raw, publicationDate: raw.publicationDate });

  const explanationProvenance = raw.explanationProvenance ?? {
    basedOnFields: [
      summary ? "summary" : null,
      evidenceSnippet ? "evidenceSnippet" : null,
      whyUseful ? "whyUseful" : null,
    ].filter(Boolean),
    aiGenerated: false,
    source: plainLanguageExplanation ? "field_fallback" : "none",
  };

  const imageDiscoveryProvenance = raw.imageDiscoveryProvenance ?? {
    method: images[0]?.origin ?? (hasImageCandidates ? "unspecified" : "none"),
    attemptedAt: raw.lastImageAttemptAt ?? null,
  };

  const evaluationProvenance = raw.evaluationProvenance ?? {
    hasScores: actionabilityScore != null || relevanceScore != null,
    source: actionabilityScore != null ? "source_curated" : "not_evaluated",
  };

  // The eligibility check needs verificationStatus/sourceUrls/hasImage*/
  // processingStatus/dataOrigin/recordId/title all already computed -
  // built as a plain object here (not the final return value yet) so
  // isDisplayEligible can read from it directly.
  const eligibilityInput = {
    recordId,
    title,
    verificationStatus,
    sourceUrls,
    hasImageCandidates,
    imageCandidateCount,
    processingStatus,
    dataOrigin,
  };
  const { displayEligible, displayEligibilityReasons } = isDisplayEligible(eligibilityInput);
  const triageDecision = displayEligible
    ? "accept"
    : processingStatus === "pending_image_enrichment"
      ? "hold_pending_image"
      : "reject";

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
    recencyScore,
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
    explanationProvenance,
    imageDiscoveryProvenance,
    evaluationProvenance,
    extractedAt: firstDefined(raw.extractedAt, raw.extracted_at, nowIso) ?? nowIso,
    processedAt: nowIso,
    // lastSeenAt is the first time this recordId was ever normalized -
    // preserved across reruns (raw.lastSeenAt already carries it forward
    // once set); lastUpdatedAt is always "now" since this function ran.
    lastSeenAt: firstDefined(raw.lastSeenAt, raw.extractedAt, raw.extracted_at, nowIso) ?? nowIso,
    lastUpdatedAt: nowIso,
    displayEligible,
    displayEligibilityReasons,
    processingStatus,
    triageDecision,
    // recordHash is computed last, from the final normalized field values
    // above (title/summary/sourceUrls/images/etc.), not from `raw` - see
    // computeRecordHash for exactly which fields feed it.
    recordHash: computeRecordHash({
      title,
      summary,
      evidenceSnippet,
      sourceUrls,
      doi,
      countryCode,
      images,
      imageIds,
      startDate: raw.startDate,
      endDate: raw.endDate,
      totalCostEur: raw.totalCostEur,
    }),
  };
}
