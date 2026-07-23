import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Reports on data/processed/research-records.json so nobody has to guess
// whether the app is showing real fetched data or is quietly still on
// whatever was last committed. Also the gate refreshData.mjs runs before
// swapping temp output into the live processed/ directory - see the
// verify() export and its `ok` field.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");
const legacyGeneratedPath = path.join(rootDir, "src/data/generated/liveResearchData.json");

const UNVERIFIED_WARN_THRESHOLD = 0.5; // warn if >50% of records are unverified

// Same five-way taxonomy scripts/processing/normalizeResearchRecord.mjs
// computes for every record - see that file for the exact rule. This
// script does not re-decide verificationStatus; it only counts and
// sanity-checks whatever the normalizer already assigned.
const VERIFICATION_STATUS_KEYS = {
  verified_api_extracted: "verifiedApiExtracted",
  source_linked_seed: "sourceLinkedSeed",
  metadata_only: "metadataOnly",
  unverified: "unverified",
  mock_demo: "mockDemo",
};

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function isOnOrAfter(dateValue, thresholdDate) {
  if (!dateValue) return false;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed >= new Date(thresholdDate);
}

export async function verify({ processedDir = defaultProcessedDir } = {}) {
  const warnings = [];
  const failures = [];

  const researchRecordsPath = path.join(processedDir, "research-records.json");
  const countryProfilesPath = path.join(processedDir, "country-profiles.json");
  const updateStatusPath = path.join(processedDir, "update-status.json");

  const researchRecordsData = await readJsonIfExists(researchRecordsPath);
  const countryProfilesData = await readJsonIfExists(countryProfilesPath);
  const updateStatusData = await readJsonIfExists(updateStatusPath);

  if (!researchRecordsData) {
    failures.push(`${researchRecordsPath} is missing or unreadable.`);
  }
  const records = researchRecordsData?.records ?? [];
  if (researchRecordsData && records.length === 0) {
    failures.push("research-records.json exists but contains zero records.");
  }
  if (!updateStatusData) {
    warnings.push("update-status.json is missing - refresh:data may never have completed successfully.");
  }

  const imageCandidatesData = await readJsonIfExists(path.join(processedDir, "image-candidates.json"));
  const recordIdsWithImageFileEntries = new Set(
    (imageCandidatesData?.images ?? []).map((image) => image.recordId)
  );

  const counts = {
    total: records.length,
    verifiedApiExtracted: 0,
    sourceLinkedSeed: 0,
    metadataOnly: 0,
    unverified: 0,
    mockDemo: 0,
    withSourceUrls: 0,
    withRawSourceFiles: 0,
    withDoi: 0,
    withOpenAlexUrl: 0,
    withAbstract: 0,
    missingAbstract: 0,
    withImages: 0,
    missingImageCandidates: 0,
    withExplanations: 0,
    missingImportantDisplayFields: 0,
    shownInFrontend: 0,
    since2020: 0,
    since2024: 0,
  };
  const countryCounts = new Map();

  records.forEach((record) => {
    const statusKey = VERIFICATION_STATUS_KEYS[record.verificationStatus];
    if (statusKey) {
      counts[statusKey]++;
    } else {
      // Anything not in the five-way taxonomy (e.g. missing entirely, or a
      // stale value from before this fix) is conservatively unverified -
      // never silently uncounted.
      counts.unverified++;
    }

    const hasSourceUrls = Boolean(record.sourceUrls?.length) || Boolean(record.sourceUrl);
    if (hasSourceUrls) counts.withSourceUrls++;
    if (record.rawSourceFiles?.length) counts.withRawSourceFiles++;
    if (record.doi) counts.withDoi++;
    if (record.openAlexUrl) counts.withOpenAlexUrl++;
    if (record.abstract) counts.withAbstract++;
    else counts.missingAbstract++;
    if (isOnOrAfter(record.publicationDate, "2020-01-01")) counts.since2020++;
    if (isOnOrAfter(record.publicationDate, "2024-01-01")) counts.since2024++;

    const hasImages =
      Boolean(record.hasImageCandidates) ||
      (record.imageIds?.length ?? 0) > 0 ||
      (record.images?.length ?? 0) > 0;
    if (hasImages) counts.withImages++;
    else counts.missingImageCandidates++;

    const hasExplanation = Boolean(
      record.plainLanguageExplanation ||
        record.whyItMatters ||
        record.problemBeingAddressed ||
        record.evidenceSnippet ||
        record.whyUseful
    );
    if (hasExplanation) counts.withExplanations++;

    // "Would be shown in the frontend" mirrors what ResearchGallery.jsx
    // actually requires today: a title plus some human-readable summary
    // text (record.summary or an explanation field) - records missing both
    // would render as a blank card, not real coverage.
    const missingImportantDisplayFields = !record.title || (!record.summary && !hasExplanation);
    if (missingImportantDisplayFields) counts.missingImportantDisplayFields++;
    else counts.shownInFrontend++;

    // Hard rules the whole five-way taxonomy exists to enforce - defence in
    // depth in case verify:data-provenance is ever run against a file that
    // wasn't produced via normalizeResearchRecord().
    if (record.verificationStatus === "verified_api_extracted") {
      const hasEvidence = hasSourceUrls || record.openAlexUrl || record.doi;
      if (!record.rawSourceFiles?.length || !hasEvidence) {
        failures.push(
          `Record ${record.recordId} is marked "verified_api_extracted" but lacks rawSourceFiles or source evidence.`
        );
      }
    }
    if (record.verificationStatus === "source_linked_seed" && !hasSourceUrls) {
      failures.push(`Record ${record.recordId} is marked "source_linked_seed" but has no sourceUrl.`);
    }
    if (
      record.verificationStatus === "unverified" &&
      (hasSourceUrls || record.rawSourceFiles?.length || record.openAlexUrl || record.doi)
    ) {
      failures.push(
        `Record ${record.recordId} is marked "unverified" but actually has source evidence - classification bug, do not mark source-linked records as unverified.`
      );
    }

    if (record.countryCode) {
      countryCounts.set(record.countryCode, (countryCounts.get(record.countryCode) ?? 0) + 1);
    }
  });

  const recordIdsClaimingImages = new Set(
    records.filter((r) => r.hasImageCandidates || r.imageIds?.length).map((r) => r.recordId)
  );
  const imageCrossCheckMismatches = [...recordIdsClaimingImages].filter(
    (id) => !recordIdsWithImageFileEntries.has(id)
  );
  if (imageCrossCheckMismatches.length > 0) {
    warnings.push(
      `${imageCrossCheckMismatches.length} record(s) claim image candidates but have no matching entry in image-candidates.json: ${imageCrossCheckMismatches.slice(0, 10).join(", ")}${imageCrossCheckMismatches.length > 10 ? ", ..." : ""}`
    );
  }

  if (counts.total > 0 && counts.unverified / counts.total > UNVERIFIED_WARN_THRESHOLD) {
    warnings.push(
      `${counts.unverified}/${counts.total} records (${Math.round((counts.unverified / counts.total) * 100)}%) are genuinely unverified (no sourceUrl/doi/openAlexUrl/rawSourceFile at all) - above the ${UNVERIFIED_WARN_THRESHOLD * 100}% threshold.`
    );
  }

  const topCountries = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([code, count]) => ({ code, count }));

  // The frontend today still bundles src/data/generated/liveResearchData.json
  // at build time (a separate, older pipeline) - this is not a failure of
  // THIS pipeline, but it must never be silently glossed over as "the
  // frontend is using live data" when it isn't yet wired to these files.
  const legacyGeneratedData = await readJsonIfExists(legacyGeneratedPath);
  const legacyProjectCount = legacyGeneratedData?.publicProjects?.length ?? 0;
  if (!legacyGeneratedData) {
    warnings.push(`Legacy frontend data file ${legacyGeneratedPath} is missing.`);
  }

  const result = {
    ok: failures.length === 0,
    failures,
    warnings,
    counts,
    countryCount: countryCounts.size,
    topCountries,
    frontendDataFilePath: {
      legacyBuildTimeImport: path.relative(rootDir, legacyGeneratedPath),
      legacyBuildTimeImportProjectCount: legacyProjectCount,
      newProcessedResearchRecords: path.relative(rootDir, researchRecordsPath),
      newProcessedCountryProfiles: path.relative(rootDir, countryProfilesPath),
      note:
        "The React app still statically imports the legacy file at build time. The new processed files are served live by server/server.mjs's /api/research-records and /api/country-profiles endpoints, but the frontend UI itself is not yet wired to call them (out of scope for this pass - see docs/AWS_DATA_REFRESH.md).",
    },
    countryProfilesCount: countryProfilesData?.countryCount ?? 0,
    lastSuccessfulFetch: updateStatusData?.lastSuccessfulFetchAt ?? null,
    updateStatus: updateStatusData,
  };

  return result;
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Data Provenance Verification");
  console.log("=".repeat(60));
  console.log(`Total records:              ${result.counts.total}`);
  console.log(`  verified_api_extracted:   ${result.counts.verifiedApiExtracted}`);
  console.log(`  source_linked_seed:       ${result.counts.sourceLinkedSeed}`);
  console.log(`  metadata_only:            ${result.counts.metadataOnly}`);
  console.log(`  unverified:               ${result.counts.unverified}`);
  console.log(`  mock_demo:                ${result.counts.mockDemo}`);
  console.log(`With source URL(s):         ${result.counts.withSourceUrls}`);
  console.log(`With raw source file:       ${result.counts.withRawSourceFiles}`);
  console.log(`With DOI:                   ${result.counts.withDoi}`);
  console.log(`With OpenAlex URL:          ${result.counts.withOpenAlexUrl}`);
  console.log(`With abstract:              ${result.counts.withAbstract}`);
  console.log(`Missing abstract:           ${result.counts.missingAbstract}`);
  console.log(`With image candidates:      ${result.counts.withImages}`);
  console.log(`Missing image candidates:   ${result.counts.missingImageCandidates}`);
  console.log(`With explanation text:      ${result.counts.withExplanations}`);
  console.log(`Missing display fields:     ${result.counts.missingImportantDisplayFields}`);
  console.log(`Would show in frontend:     ${result.counts.shownInFrontend}`);
  console.log(`Records 2020-present:       ${result.counts.since2020}`);
  console.log(`Records 2024-present:       ${result.counts.since2024}`);
  console.log(`Country count:              ${result.countryCount}`);
  console.log(`Country profiles built:     ${result.countryProfilesCount}`);
  console.log(`Top countries:              ${result.topCountries.map((c) => `${c.code}(${c.count})`).join(", ") || "none"}`);
  console.log(`Last successful fetch:      ${result.lastSuccessfulFetch ?? "never"}`);
  console.log(`Legacy frontend file:       ${result.frontendDataFilePath.legacyBuildTimeImport} (${result.frontendDataFilePath.legacyBuildTimeImportProjectCount} projects)`);
  console.log(`New processed files:        ${result.frontendDataFilePath.newProcessedResearchRecords}, ${result.frontendDataFilePath.newProcessedCountryProfiles}`);

  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.forEach((f) => console.log(`  ✗ ${f}`));
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verify();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during provenance verification:", error);
    process.exitCode = 1;
  });
}
