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

  const counts = {
    total: records.length,
    verified: 0,
    metadataOnly: 0,
    seed: 0,
    mock: 0,
    unverified: 0,
    withSourceUrl: 0,
    withRawSourceFile: 0,
    withDoi: 0,
    withOpenAlexUrl: 0,
    withAbstract: 0,
    missingAbstract: 0,
    since2020: 0,
    since2024: 0,
  };
  const countryCounts = new Map();

  records.forEach((record) => {
    switch (record.verificationStatus) {
      case "verified":
        counts.verified++;
        break;
      case "metadata_only":
        counts.metadataOnly++;
        break;
      case "seed":
        counts.seed++;
        break;
      case "mock":
        counts.mock++;
        break;
      default:
        counts.unverified++;
    }

    if (record.sourceUrls?.length) counts.withSourceUrl++;
    if (record.rawSourceFiles?.length) counts.withRawSourceFile++;
    if (record.doi) counts.withDoi++;
    if (record.openAlexUrl) counts.withOpenAlexUrl++;
    if (record.abstract) counts.withAbstract++;
    else counts.missingAbstract++;
    if (isOnOrAfter(record.publicationDate, "2020-01-01")) counts.since2020++;
    if (isOnOrAfter(record.publicationDate, "2024-01-01")) counts.since2024++;

    // A "verified" record must actually have evidence - this is the hard
    // rule the whole provenance model exists to enforce.
    if (
      record.verificationStatus === "verified" &&
      !record.sourceUrls?.length &&
      !record.rawSourceFiles?.length &&
      !record.openAlexUrl &&
      !record.doi
    ) {
      failures.push(`Record ${record.recordId} is marked "verified" but has no sourceUrl/rawSourceFile/openAlexUrl/doi.`);
    }

    if (record.countryCode) {
      countryCounts.set(record.countryCode, (countryCounts.get(record.countryCode) ?? 0) + 1);
    }
  });

  if (counts.total > 0 && counts.unverified / counts.total > UNVERIFIED_WARN_THRESHOLD) {
    warnings.push(
      `${counts.unverified}/${counts.total} records (${Math.round((counts.unverified / counts.total) * 100)}%) are unverified - above the ${UNVERIFIED_WARN_THRESHOLD * 100}% threshold.`
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
  console.log(`  verified:                 ${result.counts.verified}`);
  console.log(`  metadata_only:            ${result.counts.metadataOnly}`);
  console.log(`  seed:                     ${result.counts.seed}`);
  console.log(`  mock:                     ${result.counts.mock}`);
  console.log(`  unverified:               ${result.counts.unverified}`);
  console.log(`With source URL:            ${result.counts.withSourceUrl}`);
  console.log(`With raw source file:       ${result.counts.withRawSourceFile}`);
  console.log(`With DOI:                   ${result.counts.withDoi}`);
  console.log(`With OpenAlex URL:          ${result.counts.withOpenAlexUrl}`);
  console.log(`With abstract:              ${result.counts.withAbstract}`);
  console.log(`Missing abstract:           ${result.counts.missingAbstract}`);
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
