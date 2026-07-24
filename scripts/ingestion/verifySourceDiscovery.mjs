import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDisplayEligibility } from "./verifyDisplayEligibility.mjs";
import { BLOCKED_SOURCE_DISCOVERY_TYPES } from "../processing/sourceDiscoveryClassifier.mjs";

// Gate for the "discovered official sources are classified and justified,
// never blindly trusted" rule. Checks the queue, candidate store, and run
// report exist; every candidate has the required fields; nothing blocked
// (doi_redirect/pdf/publisher_article/random_blog/stock_photo_site/
// social_media_only/unknown) was ever selected; accepted candidates have
// real confidence and real provenance; and that source discovery - which
// never adds an actual image - hasn't polluted display-records.json or
// broken verify:display-eligibility.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifySourceDiscovery({ processedDir = defaultProcessedDir } = {}) {
  const failures = [];
  const warnings = [];

  const queuePath = path.join(processedDir, "source-discovery-queue.json");
  const candidatesPath = path.join(processedDir, "source-candidates.json");
  const reportPath = path.join(processedDir, "source-discovery-report.json");
  const researchRecordsPath = path.join(processedDir, "research-records.json");
  const pendingPath = path.join(processedDir, "pending-image-enrichment.json");
  const displayRecordsPath = path.join(processedDir, "display-records.json");

  const queueData = await readJsonIfExists(queuePath);
  const candidatesData = await readJsonIfExists(candidatesPath);
  const reportData = await readJsonIfExists(reportPath);
  const researchRecordsData = await readJsonIfExists(researchRecordsPath);
  const pendingData = await readJsonIfExists(pendingPath);
  const displayRecordsData = await readJsonIfExists(displayRecordsPath);

  // Points 1-3.
  if (!queueData) failures.push(`${path.relative(rootDir, queuePath)} does not exist or is unreadable.`);
  if (!candidatesData) failures.push(`${path.relative(rootDir, candidatesPath)} does not exist or is unreadable.`);
  if (!reportData) failures.push(`${path.relative(rootDir, reportPath)} does not exist or is unreadable.`);

  const blockedTypeSet = new Set(BLOCKED_SOURCE_DISCOVERY_TYPES);
  const counts = {
    totalCandidates: candidatesData?.candidates?.length ?? 0,
    selectedCandidates: 0,
    rejectedCandidates: 0,
    recordsQueued: queueData?.queuedCount ?? 0,
    recordsWithAcceptedSource: 0,
    recordsProcessedWithProvenance: 0,
  };

  // Points 4-10: every candidate's required fields, plus the hard rules.
  (candidatesData?.candidates ?? []).forEach((candidate) => {
    const label = candidate.sourceCandidateId || candidate.url || "(unidentified candidate)";
    if (!candidate.recordId) failures.push(`Source candidate ${label} is missing recordId.`);
    if (!candidate.url) failures.push(`Source candidate ${label} is missing url.`);
    if (!candidate.sourceType) failures.push(`Source candidate ${label} is missing sourceType.`);

    if (candidate.selected) {
      counts.selectedCandidates++;
      if (!candidate.selectionReason) {
        failures.push(`Selected source candidate ${label} is missing selectionReason.`);
      }
      if (blockedTypeSet.has(candidate.sourceType)) {
        failures.push(`Source candidate ${label} has BLOCKED sourceType "${candidate.sourceType}" but is selected=true.`);
      }
      if (["doi_redirect", "pdf", "publisher_article"].includes(candidate.sourceType)) {
        failures.push(`Source candidate ${label} is a ${candidate.sourceType} URL (${candidate.url}) but is selected=true - DOI/PDF/publisher URLs must never be selected as an official source.`);
      }
      if (candidate.confidence !== "high" && candidate.confidence !== "medium") {
        failures.push(`Selected source candidate ${label} has confidence="${candidate.confidence}" - accepted sources must be high or medium confidence.`);
      }
    } else {
      counts.rejectedCandidates++;
    }
  });

  // Point 11 + provenance cross-check for points 4-10's "lack of
  // provenance" hard-fail rule: every record this run actually touched
  // must carry a sourceDiscoveryProvenance object.
  const queuedRecordIds = new Set((queueData?.queue ?? []).map((item) => item.recordId));
  const allRecords = researchRecordsData?.records ?? [];
  allRecords.forEach((record) => {
    if (!queuedRecordIds.has(record.recordId)) return;
    if (!record.sourceDiscoveryProvenance) {
      failures.push(`Record ${record.recordId} was queued for source discovery but has no sourceDiscoveryProvenance.`);
    } else {
      counts.recordsProcessedWithProvenance++;
    }
    if (record.officialSourceCandidates?.length) {
      counts.recordsWithAcceptedSource++;
    }
  });

  // Point 12: a record with no accepted source must remain pending
  // (never promoted to displayEligible off the back of source discovery
  // alone - only enrich:images granting a real image can do that).
  const pendingIds = new Set((pendingData?.records ?? []).map((r) => r.recordId));
  allRecords.forEach((record) => {
    if (!queuedRecordIds.has(record.recordId)) return;
    const hasAcceptedSource = Boolean(record.officialSourceCandidates?.length);
    const hasImage = Boolean(record.hasImageCandidates) && (record.imageCandidateCount ?? 0) > 0;
    if (!hasAcceptedSource && !hasImage && !pendingIds.has(record.recordId) && record.displayEligible !== false) {
      failures.push(`Record ${record.recordId} has no accepted source and no image, but is not pending/ineligible.`);
    }
  });

  // Point 13: display-records.json must still only contain image-backed
  // records - source discovery must never itself make a record eligible.
  (displayRecordsData?.records ?? []).forEach((record) => {
    const hasImage = Boolean(record.hasImageCandidates) && (record.imageCandidateCount ?? 0) > 0;
    if (!hasImage) {
      failures.push(`Display record ${record.recordId} has no image candidate - source discovery must not add records to display-records.json.`);
    }
  });

  // Point 14: the display-eligibility gate itself must still pass.
  const eligibilityResult = await verifyDisplayEligibility({ processedDir });
  if (!eligibilityResult.ok) {
    failures.push(...eligibilityResult.failures.map((f) => `[verify:display-eligibility] ${f}`));
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    counts,
    reportSummary: reportData
      ? {
          attempted: reportData.attempted,
          candidatesFoundTotal: reportData.candidatesFoundTotal,
          candidatesAcceptedTotal: reportData.candidatesAcceptedTotal,
          candidatesRejectedTotal: reportData.candidatesRejectedTotal,
          promoted: reportData.promoted,
        }
      : null,
  };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Source Discovery Verification");
  console.log("=".repeat(60));
  console.log(`Records queued:                  ${result.counts.recordsQueued}`);
  console.log(`Total candidates:                ${result.counts.totalCandidates}`);
  console.log(`Selected candidates:             ${result.counts.selectedCandidates}`);
  console.log(`Rejected candidates:              ${result.counts.rejectedCandidates}`);
  console.log(`Records with accepted source:    ${result.counts.recordsWithAcceptedSource}`);
  console.log(`Records with provenance:         ${result.counts.recordsProcessedWithProvenance}`);
  if (result.reportSummary) {
    console.log(
      `Last discover:official-sources run: attempted=${result.reportSummary.attempted}, found=${result.reportSummary.candidatesFoundTotal}, accepted=${result.reportSummary.candidatesAcceptedTotal}, rejected=${result.reportSummary.candidatesRejectedTotal}, promoted=${result.reportSummary.promoted}`
    );
  }

  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.slice(0, 40).forEach((f) => console.log(`  ✗ ${f}`));
    if (result.failures.length > 40) console.log(`  ...and ${result.failures.length - 40} more.`);
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifySourceDiscovery();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:source-discovery:", error);
    process.exitCode = 1;
  });
}
