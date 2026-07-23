import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Gate for the "only real, source-proven, image-backed records reach the
// app" rule. Checks the exact 12 points required:
//   1. display-records.json exists
//   2-3. every display record has recordId / title
//   4. every display record has sourceUrls.length > 0
//   5-6. every display record has hasImageCandidates=true and
//        imageCandidateCount > 0
//   7-8. no display record has verificationStatus unverified/mock_demo
//   9. no display record has dataOrigin mock_demo
//   10-11. no display record has processingStatus rejected/
//        pending_image_enrichment
//   12. the frontend actually reads display-records.json, not the full
//        research-records.json

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");
const frontendDataSeamPath = path.join(rootDir, "src/data/researchGalleryData.js");

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifyDisplayEligibility({ processedDir = defaultProcessedDir } = {}) {
  const failures = [];
  const warnings = [];

  const displayPath = path.join(processedDir, "display-records.json");
  const pendingPath = path.join(processedDir, "pending-image-enrichment.json");
  const rejectedPath = path.join(processedDir, "rejected-records.json");
  const researchRecordsPath = path.join(processedDir, "research-records.json");

  const displayData = await readJsonIfExists(displayPath);
  const pendingData = await readJsonIfExists(pendingPath);
  const rejectedData = await readJsonIfExists(rejectedPath);
  const researchRecordsData = await readJsonIfExists(researchRecordsPath);

  // Point 1: display-records.json exists.
  if (!displayData) {
    failures.push(`${displayPath} is missing or unreadable - run npm run process:records first.`);
  }

  const displayRecords = displayData?.records ?? [];
  const totalProcessed = researchRecordsData?.records?.length ?? 0;

  const counts = {
    totalProcessed,
    displayEligible: displayRecords.length,
    hiddenNoImage: pendingData?.recordCount ?? pendingData?.records?.length ?? 0,
    hiddenUnverified: 0,
    hiddenMockDemo: 0,
    hiddenRejectedOther: 0,
    displayWithSourceUrl: 0,
    displayWithImageCandidate: 0,
    displayWithProvenance: 0,
  };

  (rejectedData?.records ?? []).forEach((record) => {
    if (record.verificationStatus === "unverified") counts.hiddenUnverified++;
    else if (record.verificationStatus === "mock_demo") counts.hiddenMockDemo++;
    else counts.hiddenRejectedOther++;
  });

  displayRecords.forEach((record) => {
    // Points 2-3.
    if (!record.recordId) failures.push(`Display record is missing recordId (title: "${record.title ?? "unknown"}").`);
    if (!record.title) failures.push(`Display record ${record.recordId ?? "unknown"} is missing title.`);

    // Point 4.
    const hasSourceUrl = (record.sourceUrls?.length ?? 0) > 0;
    if (hasSourceUrl) counts.displayWithSourceUrl++;
    else failures.push(`Display record ${record.recordId} has sourceUrls.length === 0.`);

    // Points 5-6.
    const hasImageCandidate = record.hasImageCandidates === true && (record.imageCandidateCount ?? 0) > 0;
    if (hasImageCandidate) counts.displayWithImageCandidate++;
    else failures.push(`Display record ${record.recordId} has hasImageCandidates=${record.hasImageCandidates} / imageCandidateCount=${record.imageCandidateCount}.`);

    // Points 7-8.
    if (record.verificationStatus === "unverified") {
      failures.push(`Display record ${record.recordId} has verificationStatus "unverified".`);
    }
    if (record.verificationStatus === "mock_demo") {
      failures.push(`Display record ${record.recordId} has verificationStatus "mock_demo".`);
    }

    // Point 9.
    if (record.dataOrigin === "mock_demo") {
      failures.push(`Display record ${record.recordId} has dataOrigin "mock_demo".`);
    }

    // Points 10-11.
    if (record.processingStatus === "rejected") {
      failures.push(`Display record ${record.recordId} has processingStatus "rejected".`);
    }
    if (record.processingStatus === "pending_image_enrichment") {
      failures.push(`Display record ${record.recordId} has processingStatus "pending_image_enrichment".`);
    }

    const hasProvenance = Boolean(
      record.rawSourceFiles?.length || record.sourceUrls?.length || record.doi || record.openAlexUrl
    );
    if (hasProvenance) counts.displayWithProvenance++;

    if (record.displayEligible !== true) {
      failures.push(`Display record ${record.recordId} is present in display-records.json but displayEligible !== true.`);
    }
  });

  // Point 12: frontend wiring check.
  let frontendReadsCorrectFile = false;
  try {
    const frontendSource = await fs.readFile(frontendDataSeamPath, "utf8");
    const importsDisplayRecords = /display-records\.json/.test(frontendSource);
    const importsFullResearchRecords = /(?<!display-)research-records\.json/.test(frontendSource);
    frontendReadsCorrectFile = importsDisplayRecords && !importsFullResearchRecords;
    if (!importsDisplayRecords) {
      failures.push(`${frontendDataSeamPath} does not import data/processed/display-records.json.`);
    }
    if (importsFullResearchRecords) {
      failures.push(`${frontendDataSeamPath} still imports the full research-records.json directly - frontend must only read display-records.json.`);
    }
  } catch {
    failures.push(`Could not read ${frontendDataSeamPath} to verify frontend wiring.`);
  }

  if (totalProcessed > 0 && displayRecords.length === 0) {
    warnings.push("display-records.json has zero records - nothing will show in the app.");
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    counts,
    frontendDataSeamPath: path.relative(rootDir, frontendDataSeamPath),
    frontendReadsCorrectFile,
    displayRecordsPath: path.relative(rootDir, displayPath),
  };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Display Eligibility Verification");
  console.log("=".repeat(60));
  console.log(`Total processed records:        ${result.counts.totalProcessed}`);
  console.log(`Display eligible:               ${result.counts.displayEligible}`);
  console.log(`Hidden - no image:              ${result.counts.hiddenNoImage}`);
  console.log(`Hidden - unverified:            ${result.counts.hiddenUnverified}`);
  console.log(`Hidden - mock/demo:             ${result.counts.hiddenMockDemo}`);
  console.log(`Hidden - rejected (other):      ${result.counts.hiddenRejectedOther}`);
  console.log(`Display records with sourceUrl: ${result.counts.displayWithSourceUrl}`);
  console.log(`Display records with image:     ${result.counts.displayWithImageCandidate}`);
  console.log(`Display records with provenance:${result.counts.displayWithProvenance}`);
  console.log(`Frontend data file:             ${result.frontendDataSeamPath}`);
  console.log(`Frontend reads correct file:    ${result.frontendReadsCorrectFile}`);
  console.log(`display-records.json path:      ${result.displayRecordsPath}`);

  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.slice(0, 30).forEach((f) => console.log(`  ✗ ${f}`));
    if (result.failures.length > 30) console.log(`  ...and ${result.failures.length - 30} more.`);
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifyDisplayEligibility();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during display eligibility verification:", error);
    process.exitCode = 1;
  });
}
