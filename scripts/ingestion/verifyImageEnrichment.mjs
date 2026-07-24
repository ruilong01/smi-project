import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyDisplayEligibility } from "./verifyDisplayEligibility.mjs";
import { classifyImageSourceUrl, classifySourceUrls, CLASSIFIER_VERSION } from "../processing/imageSourceClassifier.mjs";
import { QUEUE_METHOD_VERSION } from "./queueEnrichment.mjs";
import { ENRICH_METHOD_VERSION } from "./enrichImages.mjs";
import { RETRYABLE_STATUSES } from "./http.mjs";

// Gate for the "images are found systematically and safely, never faked"
// rule. Checks the queue, the candidate store, the run report, every
// individual image candidate's required fields, that records with images
// are actually marked as such, that display-records.json still only shows
// image-backed records, and that verify:display-eligibility itself still
// passes - image enrichment must never be the thing that breaks it.
//
// data/processed/image-enrichment-queue.json and image-enrichment-
// report.json are run HISTORY, not code under test - and per policy they
// are not committed as part of a code PR, so a clean clone (or a branch
// synced past a merge that dropped them) can easily be left with a queue/
// report snapshot written by an OLDER ruleset, or none at all. Treating
// that stale/missing history as a hard failure makes this verifier fail
// for reasons that have nothing to do with the code being checked. Instead:
//   - a self-contained fixture proves the actual classifier/retry/queue
//     logic is correct, independent of any production snapshot, and is
//     the only thing that can hard-fail this verifier;
//   - the production queue/report files, if present, are labelled
//     current/stale/missing by comparing their stamped classifierVersion/
//     methodVersion against this code's current versions; only a CURRENT
//     snapshot's content is held to the DOI/PDF/publisher/retry rules as a
//     hard failure, a stale one only produces a warning.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");
const testOutputDir = path.join(defaultProcessedDir, "test", "image-enrichment");

const PLACEHOLDER_URL_PATTERN = /placeholder|lorem\s*ipsum|example\.(com|org)|via\.placeholder|picsum\.photos|dummyimage/i;
const GENERIC_RIGHTS_ONLY_TEXT = /^rights not verified/i;

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

// "current" = stamped with this code's exact classifier/method versions -
// i.e. this snapshot's content can only have been produced by the rules
// being checked right now, so its content is fair game to hold to a hard
// failure. Anything else (missing entirely, or stamped with an older/
// unstamped version) is history that predates the code under test.
function freshnessStatus(data, expectedMethodVersion) {
  if (!data) return "missing";
  if (data.classifierVersion === CLASSIFIER_VERSION && data.methodVersion === expectedMethodVersion) {
    return "current";
  }
  return "stale";
}

// --- Fixture checks: prove the real classifier/retry/queue-gate logic is
// correct using known sample URLs, never depending on any production data
// file. These are the only checks that can hard-fail this verifier.
const FIXTURE_URLS = {
  doi: "https://doi.org/10.1000/example-fixture",
  pdf: "https://example-university.edu/papers/sample-fixture.pdf",
  publisher: "https://www.mdpi.com/2071-1050/13/1/298",
  cordis: "https://cordis.europa.eu/project/id/101012345",
};

function runFixtureChecks() {
  const checks = [];
  const check = (name, passed, detail) => checks.push({ name, passed, detail });

  const doiResult = classifyImageSourceUrl(FIXTURE_URLS.doi);
  check(
    "DOI URL is classified as fetch-blocked (doi_redirect)",
    doiResult.fetchAllowed === false && doiResult.category === "doi_redirect",
    doiResult
  );

  const pdfResult = classifyImageSourceUrl(FIXTURE_URLS.pdf);
  check(
    "PDF URL is classified as fetch-blocked (pdf)",
    pdfResult.fetchAllowed === false && pdfResult.category === "pdf",
    pdfResult
  );

  const publisherResult = classifyImageSourceUrl(FIXTURE_URLS.publisher);
  check(
    "Known publisher article URL is classified as fetch-blocked (publisher_article)",
    publisherResult.fetchAllowed === false && publisherResult.category === "publisher_article",
    publisherResult
  );

  const cordisResult = classifyImageSourceUrl(FIXTURE_URLS.cordis);
  check(
    "Official CORDIS project URL is classified as fetch-allowed (cordis_project)",
    cordisResult.fetchAllowed === true && cordisResult.category === "cordis_project",
    cordisResult
  );

  check(
    "HTTP 403 is NOT in the retryable-status list (never retried)",
    !RETRYABLE_STATUSES.includes(403),
    { retryableStatuses: RETRYABLE_STATUSES }
  );
  check(
    "HTTP 404 is NOT in the retryable-status list (never retried)",
    !RETRYABLE_STATUSES.includes(404),
    { retryableStatuses: RETRYABLE_STATUSES }
  );
  check(
    "HTTP 429/503 ARE in the retryable-status list (transient, retried)",
    RETRYABLE_STATUSES.includes(429) && RETRYABLE_STATUSES.includes(503),
    { retryableStatuses: RETRYABLE_STATUSES }
  );

  const doiPdfPublisherOnly = classifySourceUrls([FIXTURE_URLS.doi, FIXTURE_URLS.pdf, FIXTURE_URLS.publisher]);
  check(
    "A record whose only source URLs are DOI+PDF+publisher has NO fetch-allowed URL (never queued)",
    !doiPdfPublisherOnly.some((c) => c.fetchAllowed),
    doiPdfPublisherOnly
  );

  const doiPlusCordis = classifySourceUrls([FIXTURE_URLS.doi, FIXTURE_URLS.cordis]);
  check(
    "A record with a DOI URL alongside a real CORDIS URL still has a fetch-allowed URL (would be queued)",
    doiPlusCordis.some((c) => c.fetchAllowed),
    doiPlusCordis
  );

  return { passed: checks.every((c) => c.passed), checks };
}

async function writeFixtureReport(fixtureResult, nowIso) {
  await fs.mkdir(testOutputDir, { recursive: true });
  const report = {
    generatedAt: nowIso,
    command: "verify:image-enrichment",
    isTestOutput: true,
    classifierVersion: CLASSIFIER_VERSION,
    queueMethodVersion: QUEUE_METHOD_VERSION,
    enrichMethodVersion: ENRICH_METHOD_VERSION,
    passed: fixtureResult.passed,
    checks: fixtureResult.checks,
  };
  await fs.writeFile(
    path.join(testOutputDir, "fixture-verification-report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
}

export async function verifyImageEnrichment({ processedDir = defaultProcessedDir, nowIso = new Date().toISOString() } = {}) {
  const failures = [];
  const warnings = [];

  // Fixture checks run first and unconditionally - the only source of hard
  // failures tied to actual code behaviour rather than production history.
  const fixtureResult = runFixtureChecks();
  await writeFixtureReport(fixtureResult, nowIso);
  fixtureResult.checks
    .filter((c) => !c.passed)
    .forEach((c) => failures.push(`[fixture] ${c.name} - actual: ${JSON.stringify(c.detail)}`));

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

  // Core state files - always required, regardless of enrichment run
  // history. These reflect the current record set, not a past run's log.
  if (!candidatesData) failures.push(`${path.relative(rootDir, candidatesPath)} does not exist or is unreadable.`);
  if (!researchRecordsData) failures.push(`${path.relative(rootDir, researchRecordsPath)} does not exist or is unreadable.`);
  if (!displayRecordsData) failures.push(`${path.relative(rootDir, displayRecordsPath)} does not exist or is unreadable.`);

  const queueFreshness = freshnessStatus(queueData, QUEUE_METHOD_VERSION);
  const reportFreshness = freshnessStatus(reportData, ENRICH_METHOD_VERSION);
  if (queueFreshness === "stale") {
    warnings.push(
      `${path.relative(rootDir, queuePath)} is STALE (classifierVersion/methodVersion missing or older than current ${CLASSIFIER_VERSION}/${QUEUE_METHOD_VERSION}) - its content is informational only, not held to a hard failure.`
    );
  } else if (queueFreshness === "missing") {
    warnings.push(`${path.relative(rootDir, queuePath)} does not exist - no queue history to inspect (not a failure; run queue:image-enrichment to produce one).`);
  }
  if (reportFreshness === "stale") {
    warnings.push(
      `${path.relative(rootDir, reportPath)} is STALE (classifierVersion/methodVersion missing or older than current ${CLASSIFIER_VERSION}/${ENRICH_METHOD_VERSION}) - its content is informational only, not held to a hard failure.`
    );
  } else if (reportFreshness === "missing") {
    warnings.push(`${path.relative(rootDir, reportPath)} does not exist - no report history to inspect (not a failure; run enrich:images to produce one).`);
  }

  const counts = {
    totalImageCandidates: candidatesData?.images?.length ?? 0,
    selectedCandidates: 0,
    recordsWithImages: 0,
    recordsWithoutImages: 0,
    displayRecordsChecked: displayRecordsData?.records?.length ?? 0,
  };

  // Every image candidate's required fields - these are checked against
  // whatever candidates currently exist on record, not run history.
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

    if (image.imageUrl && PLACEHOLDER_URL_PATTERN.test(image.imageUrl)) {
      failures.push(`Image candidate ${label} uses a placeholder-looking URL: ${image.imageUrl}`);
    }

    if (image.canEmbed === true) {
      const rightsLooksExplicit = image.rightsNote && !GENERIC_RIGHTS_ONLY_TEXT.test(image.rightsNote.trim());
      if (!rightsLooksExplicit) {
        failures.push(`Image candidate ${label} has canEmbed=true but rightsNote does not clearly document reuse rights: "${image.rightsNote ?? ""}"`);
      }
    }
  });

  // Record-level image bookkeeping consistency - current record state.
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

  // display-records.json must still only contain image-backed records.
  (displayRecordsData?.records ?? []).forEach((record) => {
    const hasImage = Boolean(record.hasImageCandidates) && (record.imageCandidateCount ?? 0) > 0;
    if (!hasImage) {
      failures.push(`Display record ${record.recordId} has no image candidate - must not be in display-records.json.`);
    }
  });

  // The display-eligibility gate itself must still pass.
  const eligibilityResult = await verifyDisplayEligibility({ processedDir });
  if (!eligibilityResult.ok) {
    failures.push(...eligibilityResult.failures.map((f) => `[verify:display-eligibility] ${f}`));
  }

  // --- Everything below inspects queue/report RUN HISTORY. Only ever a
  // hard failure when that specific file is "current" (stamped with this
  // code's exact versions); otherwise the same finding is a warning, since
  // it reflects an older ruleset's behaviour, not the code being checked.
  const queueTarget = queueFreshness === "current" ? failures : warnings;
  const queueTargetLabel = queueFreshness === "current" ? "" : "[stale queue snapshot] ";
  (queueData?.queue ?? []).forEach((item) => {
    const fetchAllowed = item.fetchAllowedSourceUrls ?? (item.sourceUrlClassifications ?? []).filter((c) => c.fetchAllowed).map((c) => c.url);
    if (fetchAllowed.length === 0) {
      const categories = (item.sourceUrlClassifications ?? []).map((c) => c.category).join(", ") || "unknown";
      queueTarget.push(
        `${queueTargetLabel}Queued record ${item.recordId} has no fetch-allowed source URL (categories: ${categories}) - DOI/PDF/publisher-only records must never be queued.`
      );
    }
  });

  const reportTarget = reportFreshness === "current" ? failures : warnings;
  const reportTargetLabel = reportFreshness === "current" ? "" : "[stale report snapshot] ";
  (reportData?.entries ?? []).forEach((entry) => {
    (entry.sourcePagesChecked ?? []).forEach((url) => {
      const classification = classifyImageSourceUrl(url);
      if (!classification.fetchAllowed) {
        reportTarget.push(
          `${reportTargetLabel}Record ${entry.recordId}: sourcePagesChecked includes a fetch-BLOCKED URL (${classification.category}): ${url} - this URL should have been skipped, never fetched.`
        );
      }
    });

    (entry.sourcePagesSkipped ?? []).forEach((skipped) => {
      if (!skipped.url || !skipped.reason) {
        reportTarget.push(`${reportTargetLabel}Record ${entry.recordId}: a skipped source URL is missing url/reason: ${JSON.stringify(skipped)}`);
      }
    });
  });

  const crossCheckTarget = queueFreshness === "current" && reportFreshness === "current" ? failures : warnings;
  const crossCheckLabel = crossCheckTarget === failures ? "" : "[stale queue/report snapshot] ";
  const reportEntryByRecordId = new Map((reportData?.entries ?? []).map((e) => [e.recordId, e]));
  (queueData?.queue ?? []).forEach((item) => {
    const blocked = item.blockedSourceUrls ?? [];
    if (blocked.length === 0) return;
    const entry = reportEntryByRecordId.get(item.recordId);
    if (!entry) return;
    const skippedUrls = new Set((entry.sourcePagesSkipped ?? []).map((s) => s.url));
    blocked.forEach((url) => {
      if (!skippedUrls.has(url)) {
        crossCheckTarget.push(`${crossCheckLabel}Record ${item.recordId}: blocked source URL ${url} is not recorded in sourcePagesSkipped with a reason.`);
      }
    });
  });

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    counts,
    fixtureChecks: fixtureResult,
    productionDataStatus: { queue: queueFreshness, report: reportFreshness },
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
  console.log(`Fixture checks:              ${result.fixtureChecks.checks.filter((c) => c.passed).length}/${result.fixtureChecks.checks.length} passed`);
  console.log(`Production queue snapshot:   ${result.productionDataStatus.queue}`);
  console.log(`Production report snapshot:  ${result.productionDataStatus.report}`);
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

  if (!result.fixtureChecks.passed) {
    console.log("\nFixture check failures:");
    result.fixtureChecks.checks
      .filter((c) => !c.passed)
      .forEach((c) => console.log(`  ✗ ${c.name} - actual: ${JSON.stringify(c.detail)}`));
  }

  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.slice(0, 40).forEach((w) => console.log(`  ⚠ ${w}`));
    if (result.warnings.length > 40) console.log(`  ...and ${result.warnings.length - 40} more.`);
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
