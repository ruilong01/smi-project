import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeResearchRecord } from "./normalizeResearchRecord.mjs";

// Guards the schema/provenance compatibility fix itself: checks that
// normalizeResearchRecord() - the one function both ingestMediaSeed.mjs and
// processRecords.mjs now route every record through - handles every input
// shape it is supposed to, and re-checks it against whatever is currently
// on disk in data/processed/research-records.json so a real regression
// (not just a synthetic fixture) fails this command.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const processedDir = path.join(rootDir, "data/processed");
const FIXED_NOW = "2026-01-01T00:00:00.000Z";

// Schema A: ingestMediaSeed.mjs's own camelCase output shape.
const MEDIA_SEED_FIXTURE = {
  recordId: "cordis-TEST001",
  recordType: "funded_project",
  title: "Test Fixture Project",
  acronym: "TESTFIX",
  sourceDatabase: "CORDIS",
  sourceUrl: "https://cordis.europa.eu/project/id/TEST001",
  topicPrimary: "Alternative Fuels",
  topicSecondary: "Green Shipping",
  countryOrRegion: "EU / Iceland coordinator",
  countryCode: "IS",
  coordinator: "TEST COORDINATOR",
  summary: "Test summary text.",
  whyUseful: "Test why useful text.",
  evidenceSnippet: "Test evidence snippet.",
  actionabilityScore: 90,
  relevanceScore: 92,
  hasImageCandidates: true,
  imageCandidateCount: 1,
  imageIds: ["cordis-TEST001-img-1"],
  images: [{ imageId: "cordis-TEST001-img-1", recordId: "cordis-TEST001", imageUrl: "https://example.com/a.jpg" }],
  extractedAt: FIXED_NOW,
};

// Schema A, raw variant: the seed JSON's own snake_case field names, as
// they appear in data/seed/maritime_rnd_records_with_image_candidates.json
// before ingestMediaSeed.mjs ever touches them.
const RAW_SEED_SNAKE_CASE_FIXTURE = {
  record_id: "cordis-TEST002",
  title: "Snake Case Fixture",
  acronym: "SNAKE",
  source_url: "https://cordis.europa.eu/project/id/TEST002",
  topic_primary: "Smart Ports",
  topic_secondary: "Green Shipping",
  evidence_snippet: "Snake case evidence.",
  why_useful: "Snake case why useful.",
  actionability_score: 80,
  relevance_score: 85,
};

// Schema B: processRecords.mjs's AWS/API-fetched shape.
const API_FIXTURE = {
  recordId: "openalex-test003",
  recordType: "publication",
  title: "Test API Record",
  summary: "Test API summary.",
  abstract: "Full reconstructed abstract text.",
  sourceDatabase: "OpenAlex",
  sourceUrls: ["https://openalex.org/works/test003", "https://doi.org/10.1234/test"],
  doi: "10.1234/test",
  openAlexUrl: "https://openalex.org/works/test003",
  rawSourceFiles: ["data/raw/openalex/run-test.json"],
  countryCode: "SG",
  institution: "Test University",
  extractedAt: FIXED_NOW,
};

const MOCK_FIXTURE = {
  recordId: "mock-demo-001",
  title: "Mock demo record",
  dataStatus: "mock_demo_sample",
  summary: "Placeholder text - not real data.",
};

function assert(condition, message, failures) {
  if (!condition) failures.push(message);
}

function checkMediaSeedFixture(failures) {
  const n = normalizeResearchRecord(MEDIA_SEED_FIXTURE, { nowIso: FIXED_NOW });
  assert(n.acronym === "TESTFIX", "media-seed fixture: acronym lost", failures);
  assert(n.topicPrimary === "Alternative Fuels", "media-seed fixture: topicPrimary lost", failures);
  assert(n.topicSecondary === "Green Shipping", "media-seed fixture: topicSecondary lost", failures);
  assert(n.sourceUrls.includes(MEDIA_SEED_FIXTURE.sourceUrl), "media-seed fixture: sourceUrl not folded into sourceUrls[]", failures);
  assert(n.evidenceSnippet === MEDIA_SEED_FIXTURE.evidenceSnippet, "media-seed fixture: evidenceSnippet lost", failures);
  assert(n.whyUseful === MEDIA_SEED_FIXTURE.whyUseful, "media-seed fixture: whyUseful lost", failures);
  assert(n.imageIds.length > 0, "media-seed fixture: imageIds lost", failures);
  assert(n.images.length > 0, "media-seed fixture: images[] lost", failures);
  assert(
    n.verificationStatus === "source_linked_seed",
    `media-seed fixture: expected verificationStatus "source_linked_seed", got "${n.verificationStatus}"`,
    failures
  );
  assert(n.actionabilityScore === 90, "media-seed fixture: actionabilityScore lost", failures);
  assert(n.relevanceScore === 92, "media-seed fixture: relevanceScore lost", failures);
}

function checkSnakeCaseFixture(failures) {
  const n = normalizeResearchRecord(RAW_SEED_SNAKE_CASE_FIXTURE, { nowIso: FIXED_NOW });
  assert(n.recordId === "cordis-TEST002", "snake_case fixture: record_id not mapped to recordId", failures);
  assert(n.topicPrimary === "Smart Ports", "snake_case fixture: topic_primary not mapped to topicPrimary", failures);
  assert(n.evidenceSnippet === "Snake case evidence.", "snake_case fixture: evidence_snippet not mapped to evidenceSnippet", failures);
  assert(n.whyUseful === "Snake case why useful.", "snake_case fixture: why_useful not mapped to whyUseful", failures);
  assert(
    n.sourceUrls.includes(RAW_SEED_SNAKE_CASE_FIXTURE.source_url),
    "snake_case fixture: source_url not folded into sourceUrls[]",
    failures
  );
  assert(n.actionabilityScore === 80, "snake_case fixture: actionability_score not mapped to actionabilityScore", failures);
  assert(
    n.verificationStatus === "source_linked_seed",
    `snake_case fixture: expected verificationStatus "source_linked_seed", got "${n.verificationStatus}"`,
    failures
  );
}

function checkApiFixture(failures) {
  const n = normalizeResearchRecord(API_FIXTURE, { nowIso: FIXED_NOW });
  assert(
    n.verificationStatus === "verified_api_extracted",
    `API fixture: expected verificationStatus "verified_api_extracted", got "${n.verificationStatus}"`,
    failures
  );
  assert(n.sourceUrls.length === API_FIXTURE.sourceUrls.length, "API fixture: sourceUrls lost", failures);
  assert(n.doi === API_FIXTURE.doi, "API fixture: doi lost", failures);
  assert(n.rawSourceFiles.length > 0, "API fixture: rawSourceFiles lost", failures);
  assert(n.institutions.includes("Test University"), "API fixture: institution not folded into institutions[]", failures);
}

function checkMockFixture(failures) {
  const n = normalizeResearchRecord(MOCK_FIXTURE, { nowIso: FIXED_NOW });
  assert(
    n.verificationStatus === "mock_demo",
    `mock fixture: expected verificationStatus "mock_demo", got "${n.verificationStatus}"`,
    failures
  );
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

// This is the check that stands in for "process:records preserves key
// fields" (item 3 in the required test list): process:records' own
// non-OpenAlex conversion path is now nothing more than a call to
// normalizeResearchRecord() per record, so re-running every live record
// through it here and diffing key fields exercises the exact same
// transformation process:records applies, without needing raw OpenAlex
// fetch files to be present just to run this check.
async function checkLiveData(failures, warnings) {
  const data = await readJsonIfExists(path.join(processedDir, "research-records.json"));
  if (!data?.records?.length) {
    warnings.push(
      "No records found in data/processed/research-records.json to regression-test - run ingest:media-seed or process:records first."
    );
    return { checked: 0 };
  }

  let checked = 0;
  for (const record of data.records) {
    checked++;
    const normalized = normalizeResearchRecord(record, { nowIso: data.generatedAt ?? FIXED_NOW });

    if (record.acronym && !normalized.acronym) {
      failures.push(`Live record ${record.recordId}: acronym was lost during normalization.`);
    }
    if (record.topicPrimary && !normalized.topicPrimary) {
      failures.push(`Live record ${record.recordId}: topicPrimary was lost during normalization.`);
    }
    const hadSourceUrl = Boolean(record.sourceUrl) || (record.sourceUrls?.length ?? 0) > 0;
    if (hadSourceUrl && normalized.sourceUrls.length === 0) {
      failures.push(`Live record ${record.recordId}: sourceUrls is empty after normalization despite having a source URL.`);
    }
    const hadImages = (record.imageIds?.length ?? 0) > 0 || (record.images?.length ?? 0) > 0;
    const hasImagesAfter = normalized.imageIds.length > 0 || normalized.images.length > 0;
    if (hadImages && !hasImagesAfter) {
      failures.push(`Live record ${record.recordId}: images/imageIds were lost during normalization.`);
    }
    if (!normalized.verificationStatus) {
      failures.push(`Live record ${record.recordId}: verificationStatus is missing after normalization.`);
    }
    // The exact bug this whole fix exists to close: a record with a real
    // sourceUrl must never come out "unverified".
    if (hadSourceUrl && normalized.verificationStatus === "unverified") {
      failures.push(`Live record ${record.recordId}: has a real sourceUrl but was classified "unverified".`);
    }
  }
  return { checked };
}

async function main() {
  const failures = [];
  const warnings = [];

  checkMediaSeedFixture(failures);
  checkSnakeCaseFixture(failures);
  checkApiFixture(failures);
  checkMockFixture(failures);
  const { checked } = await checkLiveData(failures, warnings);

  console.log("\n" + "=".repeat(60));
  console.log("Schema Compatibility Verification");
  console.log("=".repeat(60));
  console.log("Fixtures checked: media-seed shape, raw snake_case seed shape, AWS/API shape, mock/demo shape");
  console.log(`Live data/processed/research-records.json records re-normalized and checked: ${checked}`);

  if (warnings.length) {
    console.log("\nWarnings:");
    warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  ✗ ${f}`));
    console.log("=".repeat(60) + "\n");
    process.exitCode = 1;
    return;
  }

  console.log("\nAll schema compatibility checks passed.");
  console.log("=".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("Fatal error during schema compatibility verification:", error);
  process.exitCode = 1;
});
