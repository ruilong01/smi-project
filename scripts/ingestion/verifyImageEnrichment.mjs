import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDisplayEligibility } from "./verifyDisplayEligibility.mjs";
import { classifyImageSourceUrl } from "../processing/imageSourceClassifier.mjs";

// Gate for the "images are found systematically and safely, never faked"
// rule. Checks the queue, the candidate store, the run report, every
// individual image candidate's required fields, that records with images
// are actually marked as such, that display-records.json still only shows
// image-backed records, and that verify:display-eligibility itself still
// passes - image enrichment must never be the thing that breaks it.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");

const PLACEHOLDER_URL_PATTERN = /placeholder|lorem\s*ipsum|example\.(com|org)|via\.placeholder|picsum\.photos|dummyimage/i;
const GENERIC_RIGHTS_ONLY_TEXT = /^rights not verified/i;

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifyImageEnrichment({ processedDir = defaultProcessedDir } = {}) {
  const failures = [];
  const warnings = [];

  const queuePath = path.join(processedDir, "image-enrichment-queue.json");
  const candidatesPath = path.join(processedDir, "image-candidates.json");
  const reportPath = path.join(processedDir, "image-enrichment-report.json");
  const researchRecordsPath = path.join(processedDir, "research-records.json");
  const displayRecordsPath = path.join(processedDir, "display-records.json");

  const queueData = await readJsonIfExists(queuePath);
  const candidatesData = await readJsonIfExists(candidatesPath);
  const reportData = await readJsonIfExists(reportPath);
  const researchRecordsData = await readJsonIfExists(researchRecordsPath);
  const displayRecordsData = await readJsonIfExists(displayRecordsPath);

  // Points 1-3.
  if (!queueData) failures.push(`${path.relative(rootDir, queuePath)} does not exist or is unreadable.`);
  if (!candidatesData) failures.push(`${path.relative(rootDir, candidatesPath)} does not exist or is unreadable.`);
  if (!reportData) failures.push(`${path.relative(rootDir, reportPath)} does not exist or is unreadable.`);

  const counts = {
    totalImageCandidates: candidatesData?.images?.length ?? 0,
    selectedCandidates: 0,
    recordsWithImages: 0,
    recordsWithoutImages: 0,
    displayRecordsChecked: displayRecordsData?.records?.length ?? 0,
  };

  // Points 4-10: every image candidate's required fields.
  (candidatesData?.images ?? []).forEach((image) => {
    const label = image.imageId || image.imageUrl || "(unidentified image)";
    if (!image.imageId) failures.push(`Image candidate ${label} is missing imageId.`);
    if (!image.recordId) failures.push(`Image candidate ${label} is missing recordId.`);
    if (!image.imageUrl) failures.push(`Image candidate ${label} is missing imageUrl.`);
    if (!image.sourceUrl) failures.push(`Image candidate ${label} is missing sourceUrl.`);
    if (!image.sourceName && !image.sourceUrl) failures.push(`Image candidate ${label} has neither sourceName nor sourceUrl.`);
    if (!image.rightsNote) failures.push(`Image candidate ${label} is missing rightsNote.`);
    if (image.selected) {
      counts.selectedCandidates++;
      if (!image.selectionReason) failures.push(`Selected image candidate ${label} is missing selectionReason.`);
    }

    // Point 11.
    if (image.imageUrl && PLACEHOLDER_URL_PATTERN.test(image.imageUrl)) {
      failures.push(`Image candidate ${label} uses a placeholder-looking URL: ${image.imageUrl}`);
    }

    // Point 12.
    if (image.canEmbed === true) {
      const rightsLooksExplicit = image.rightsNote && !GENERIC_RIGHTS_ONLY_TEXT.test(image.rightsNote.trim());
      if (!rightsLooksExplicit) {
        failures.push(`Image candidate ${label} has canEmbed=true but rightsNote does not clearly document reuse rights: "${image.rightsNote ?? ""}"`);
      }
    }
  });

  // Points 13-14: record-level image bookkeeping consistency.
  (researchRecordsData?.records ?? []).forEach((record) => {
    const claimsImages = Boolean(record.hasImageCandidates) && (record.imageCandidateCount ?? 0) > 0;
    const actuallyHasImages = (record.images?.length ?? 0) > 0 || (record.imageIds?.length ?? 0) > 0;

    if (actuallyHasImages && !record.hasImageCandidates) {
      failures.push(`Record ${record.recordId} has image(s) but hasImageCandidates is not true.`);
    }
    if (claimsImages) {
      counts.recordsWithImages++;
    } else {
      counts.recordsWithoutImages++;
      if (record.processingStatus !== "pending_image_enrichment" && record.displayEligible !== false) {
        failures.push(
          `Record ${record.recordId} has no image candidates but is neither processingStatus="pending_image_enrichment" nor displayEligible=false.`
        );
      }
    }
  });

  // Point 15: display-records.json must still only contain image-backed records.
  (displayRecordsData?.records ?? []).forEach((record) => {
    const hasImage = Boolean(record.hasImageCandidates) && (record.imageCandidateCount ?? 0) > 0;
    if (!hasImage) {
      failures.push(`Display record ${record.recordId} has no image candidate - must not be in display-records.json.`);
    }
  });

  // Point 16: the display-eligibility gate itself must still pass.
  const eligibilityResult = await verifyDisplayEligibility({ processedDir });
  if (!eligibilityResult.ok) {
    failures.push(...eligibilityResult.failures.map((f) => `[verify:display-eligibility] ${f}`));
  }

  // Points 1-3 (queue-content half): no queued record may be DOI-only,
  // PDF-only, or publisher-only - every queued record must have had at
  // least one fetch-allowed source URL at queue time.
  (queueData?.queue ?? []).forEach((item) => {
    const fetchAllowed = item.fetchAllowedSourceUrls ?? (item.sourceUrlClassifications ?? []).filter((c) => c.fetchAllowed).map((c) => c.url);
    if (fetchAllowed.length === 0) {
      const categories = (item.sourceUrlClassifications ?? []).map((c) => c.category).join(", ") || "unknown";
      failures.push(
        `Queued record ${item.recordId} has no fetch-allowed source URL (categories: ${categories}) - DOI/PDF/publisher-only records must never be queued.`
      );
    }
  });

  // Points 4-5: no actual fetch attempt (sourcePagesChecked - the real
  // network calls) may target a URL that classifies as FETCH_BLOCKED. This
  // is the direct, structural proof that no retry-on-403 against a
  // doi.org/publisher/PDF URL happened - a blocked URL is never fetched at
  // all under the current code, so none can appear here.
  (reportData?.entries ?? []).forEach((entry) => {
    (entry.sourcePagesChecked ?? []).forEach((url) => {
      const classification = classifyImageSourceUrl(url);
      if (!classification.fetchAllowed) {
        failures.push(
          `Record ${entry.recordId}: sourcePagesChecked includes a fetch-BLOCKED URL (${classification.category}): ${url} - this URL should have been skipped, never fetched.`
        );
      }
    });

    // Point 6: every skipped URL must be recorded with a reason.
    (entry.sourcePagesSkipped ?? []).forEach((skipped) => {
      if (!skipped.url || !skipped.reason) {
        failures.push(`Record ${entry.recordId}: a skipped source URL is missing url/reason: ${JSON.stringify(skipped)}`);
      }
    });
  });

  // Cross-check point 6 the other way too: every record's raw sourceUrls
  // classified as blocked (from the queue, where full sourceUrls is known)
  // must show up in that record's own sourcePagesSkipped list in the
  // report - a blocked URL that's simply absent from both checked AND
  // skipped would mean it was silently dropped, not accounted for.
  const reportEntryByRecordId = new Map((reportData?.entries ?? []).map((e) => [e.recordId, e]));
  (queueData?.queue ?? []).forEach((item) => {
    const blocked = item.blockedSourceUrls ?? [];
    if (blocked.length === 0) return;
    const entry = reportEntryByRecordId.get(item.recordId);
    if (!entry) return; // not part of this specific enrich:images run - nothing to cross-check yet
    const skippedUrls = new Set((entry.sourcePagesSkipped ?? []).map((s) => s.url));
    blocked.forEach((url) => {
      if (!skippedUrls.has(url)) {
        failures.push(`Record ${item.recordId}: blocked source URL ${url} is not recorded in sourcePagesSkipped with a reason.`);
      }
    });
  });

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    counts,
    queueSummary: queueData
      ? { limit: queueData.limit, queuedCount: queueData.queuedCount, totalCandidatesConsidered: queueData.totalCandidatesConsidered }
      : null,
    reportSummary: reportData
      ? {
          attempted: reportData.attempted,
          recordsGivenImages: reportData.recordsGivenImages,
          recordsStillPending: reportData.recordsStillPending,
          promoted: reportData.promoted,
        }
      : null,
  };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Image Enrichment Verification");
  console.log("=".repeat(60));
  console.log(`Total image candidates:      ${result.counts.totalImageCandidates}`);
  console.log(`Selected candidates:         ${result.counts.selectedCandidates}`);
  console.log(`Records with images:         ${result.counts.recordsWithImages}`);
  console.log(`Records without images:      ${result.counts.recordsWithoutImages}`);
  console.log(`Display records checked:     ${result.counts.displayRecordsChecked}`);
  if (result.queueSummary) {
    console.log(`Queue: limit=${result.queueSummary.limit}, queued=${result.queueSummary.queuedCount}, considered=${result.queueSummary.totalCandidatesConsidered}`);
  }
  if (result.reportSummary) {
    console.log(
      `Last enrich:images run: attempted=${result.reportSummary.attempted}, given images=${result.reportSummary.recordsGivenImages}, still pending=${result.reportSummary.recordsStillPending}, promoted=${result.reportSummary.promoted}`
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
  const result = await verifyImageEnrichment();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:image-enrichment:", error);
    process.exitCode = 1;
  });
}
