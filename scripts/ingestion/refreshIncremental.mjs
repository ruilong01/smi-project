import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGlobalUpdates } from "./fetchGlobalUpdates.mjs";
import { processRecords } from "./processRecords.mjs";
import { compareRecords } from "./compareRecords.mjs";
import { triageRecords } from "./triageRecords.mjs";
import { queueEnrichment } from "./queueEnrichment.mjs";
import { enrichImages } from "./enrichImages.mjs";
import { enrichExplanations } from "./enrichExplanations.mjs";
import { buildCountryProfiles } from "./buildCountryProfiles.mjs";
import { verify } from "./verifyDataProvenance.mjs";
import { verifyDisplayEligibility } from "./verifyDisplayEligibility.mjs";

// The weekday 5am Asia/Singapore scheduled command (see
// docs/AWS_WEEKDAY_REFRESH.md) - an incremental counterpart to
// refresh:data that only looks at what changed since the last successful
// run, then re-derives display-records.json/pending-image-enrichment.json/
// rejected-records.json from the result.
//
// Everything happens inside a temp directory first. Only if BOTH
// verify:data-provenance and verify:display-eligibility pass against that
// temp output, and the record count isn't unexpectedly zero, does it
// replace the live data/processed/ files - so a bad or empty refresh can
// never take down what users are currently seeing. See moveTempIntoPlace.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const processedDir = path.join(rootDir, "data/processed");
const logsDir = path.join(rootDir, "data/logs");
const logFilePath = path.join(logsDir, "weekday-refresh.log");
const updateStatusPath = path.join(processedDir, "update-status.json");

const PROMOTED_FILES = [
  "research-records.json",
  "country-profiles.json",
  "display-records.json",
  "pending-image-enrichment.json",
  "rejected-records.json",
  "image-candidates.json",
  "research-evaluations.json",
  "enrichment-queue.json",
];

function nowStamp() {
  return new Date().toISOString();
}

async function withLogging(fn) {
  await fs.mkdir(logsDir, { recursive: true });
  const lines = [];
  const log = (message) => {
    const line = `[${nowStamp()}] ${message}`;
    lines.push(line);
    console.log(message);
  };
  try {
    return await fn(log);
  } finally {
    await fs.appendFile(logFilePath, `${lines.join("\n")}\n`);
  }
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function copyIfExists(src, dest) {
  try {
    await fs.copyFile(src, dest);
  } catch {
    // Nothing to seed from yet (first-ever run) - the enrichment step will
    // create it fresh in the temp dir instead.
  }
}

async function writeUpdateStatus(status) {
  await fs.mkdir(processedDir, { recursive: true });
  await fs.writeFile(updateStatusPath, `${JSON.stringify(status, null, 2)}\n`);
}

async function moveTempIntoPlace(tempDir) {
  for (const fileName of PROMOTED_FILES) {
    const tempPath = path.join(tempDir, fileName);
    try {
      await fs.access(tempPath);
    } catch {
      continue; // optional file this run didn't produce - leave the live one alone
    }
    await fs.copyFile(tempPath, path.join(processedDir, fileName));
  }
}

export async function refreshIncremental() {
  return withLogging(async (log) => {
    const attemptedAt = nowStamp();
    const previousStatus = await readJsonIfExists(updateStatusPath);
    const previousResearchRecords = (await readJsonIfExists(path.join(processedDir, "research-records.json")))?.records ?? [];

    log("=".repeat(60));
    log("refresh:incremental starting (weekday 5am Asia/Singapore job)");
    log("=".repeat(60));

    const tempDir = path.join(processedDir, `.tmp-incremental-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });

    try {
      log("Step 1/10: fetch:global-updates");
      const fetchResult = await fetchGlobalUpdates({ nowIso: attemptedAt });
      log(`  window ${fetchResult.windowStart} -> ${fetchResult.windowEnd}: ${fetchResult.workCount} work(s)`);

      log("Step 2/10: process:records (into temp dir)");
      const processResult = await processRecords({ outputDir: tempDir, nowIso: attemptedAt });
      log(`  ${processResult.recordCount} total records (${processResult.droppedCount} dropped)`);

      log("Step 3/10: compare:records (classify new/updated/unchanged)");
      const tempRecords = (await readJsonIfExists(path.join(tempDir, "research-records.json")))?.records ?? [];
      const compareResults = compareRecords(tempRecords, previousResearchRecords);
      const compareCounts = compareResults.reduce((acc, r) => {
        acc[r.classification] = (acc[r.classification] ?? 0) + 1;
        return acc;
      }, {});
      log(`  new=${compareCounts.new ?? 0} updated=${compareCounts.updated ?? 0} unchanged=${compareCounts.unchanged ?? 0} duplicate=${compareCounts.duplicate ?? 0} needs_manual_review=${compareCounts.needs_manual_review ?? 0}`);

      // Seed the temp dir with the live image-candidates.json/research-
      // evaluations.json so enrich:images/enrich:explanations merge onto
      // the real existing baseline, not an empty file.
      await copyIfExists(path.join(processedDir, "image-candidates.json"), path.join(tempDir, "image-candidates.json"));
      await copyIfExists(path.join(processedDir, "research-evaluations.json"), path.join(tempDir, "research-evaluations.json"));

      log("Step 4/10: triage:records - pass 1 (into temp dir)");
      await triageRecords({ processedDir: tempDir, nowIso: attemptedAt });

      log("Step 5/10: queue:enrichment (into temp dir)");
      const queueResult = await queueEnrichment({ processedDir: tempDir, nowIso: attemptedAt });
      log(`  ${queueResult.queuedCount} record(s) queued (${queueResult.highPriorityCount} high priority)`);

      log("Step 6/10: enrich:images (into temp dir)");
      const imagesResult = await enrichImages({ processedDir: tempDir, nowIso: attemptedAt });
      log(`  attempted ${imagesResult.attempted}, found images for ${imagesResult.found}, errors ${imagesResult.errors}`);

      log("Step 7/10: triage:records - pass 2 (re-triage after new images, into temp dir)");
      const triageResult = await triageRecords({ processedDir: tempDir, nowIso: attemptedAt });

      log("Step 8/10: enrich:explanations (into temp dir)");
      const explanationsResult = await enrichExplanations({ processedDir: tempDir, nowIso: attemptedAt });
      log(`  generated ${explanationsResult.generated} new explanation(s)`);

      log("Step 9/10: build:country-profiles (into temp dir)");
      const countryResult = await buildCountryProfiles({ inputDir: tempDir, outputDir: tempDir, nowIso: attemptedAt });

      log("Step 10/10: verify:data-provenance + verify:display-eligibility (against temp dir)");
      const provenanceResult = await verify({ processedDir: tempDir });
      if (!provenanceResult.ok) {
        throw new Error(`verify:data-provenance failed: ${provenanceResult.failures.join("; ")}`);
      }
      const eligibilityResult = await verifyDisplayEligibility({ processedDir: tempDir });
      if (!eligibilityResult.ok) {
        throw new Error(`verify:display-eligibility failed: ${eligibilityResult.failures.join("; ")}`);
      }
      if (tempRecords.length === 0) {
        throw new Error("record count is unexpectedly zero - refusing to promote.");
      }

      log("All verifications passed - promoting temp output into data/processed/");
      await moveTempIntoPlace(tempDir);

      const status = {
        lastSuccessfulRefreshAt: attemptedAt,
        lastAttemptedRefreshAt: attemptedAt,
        lastIncrementalWindowStart: fetchResult.windowStart,
        lastIncrementalWindowEnd: fetchResult.windowEnd,
        recordsFetched: fetchResult.workCount,
        recordsNew: compareCounts.new ?? 0,
        recordsUpdated: compareCounts.updated ?? 0,
        recordsUnchanged: compareCounts.unchanged ?? 0,
        duplicatesSkipped: compareCounts.duplicate ?? 0,
        recordsMovedToImageQueue: queueResult.queuedCount,
        recordsDisplayEligible: triageResult.displayEligibleCount,
        recordsPendingImageEnrichment: triageResult.pendingImageEnrichmentCount,
        status: "success",
        errors: [],
      };
      await writeUpdateStatus(status);
      log("refresh:incremental completed successfully.");
      return status;
    } catch (error) {
      log(`refresh:incremental FAILED: ${error.message}`);
      log("Keeping previous processed dataset unchanged - display-records.json and country-profiles.json were not touched.");

      const status = {
        lastSuccessfulRefreshAt: previousStatus?.lastSuccessfulRefreshAt ?? "",
        lastAttemptedRefreshAt: attemptedAt,
        lastIncrementalWindowStart: previousStatus?.lastIncrementalWindowStart ?? "",
        lastIncrementalWindowEnd: previousStatus?.lastIncrementalWindowEnd ?? "",
        recordsFetched: previousStatus?.recordsFetched ?? 0,
        recordsNew: 0,
        recordsUpdated: 0,
        recordsUnchanged: previousStatus?.recordsUnchanged ?? 0,
        duplicatesSkipped: 0,
        recordsMovedToImageQueue: previousStatus?.recordsMovedToImageQueue ?? 0,
        recordsDisplayEligible: previousStatus?.recordsDisplayEligible ?? 0,
        recordsPendingImageEnrichment: previousStatus?.recordsPendingImageEnrichment ?? 0,
        status: "failed",
        errors: [error.message],
      };
      await writeUpdateStatus(status);
      throw error;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

async function main() {
  await refreshIncremental();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during refresh:incremental:", error.message);
    process.exitCode = 1;
  });
}
