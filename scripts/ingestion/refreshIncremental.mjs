import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchGlobalUpdates } from "./fetchGlobalUpdates.mjs";
import { processRecords } from "./processRecords.mjs";
import { compareRecords } from "./compareRecords.mjs";
import { triageRecords } from "./triageRecords.mjs";
import { queueImageEnrichment } from "./queueEnrichment.mjs";
import { enrichImages } from "./enrichImages.mjs";
import { enrichExplanations } from "./enrichExplanations.mjs";
import { buildCountryProfiles } from "./buildCountryProfiles.mjs";
import { verify } from "./verifyDataProvenance.mjs";
import { verifyDisplayEligibility } from "./verifyDisplayEligibility.mjs";
import { OPENALEX_EMAIL } from "./config.mjs";
import { isCurationConfigured } from "./aiCuration/config.mjs";

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

// No real API key is required for this pipeline to run at all - OpenAlex
// (the only live network source refresh:incremental calls) is a free/open
// API with no key, just a polite-pool contact identifier. This only
// reports what's SET vs DEFAULT/UNSET - it never prints an actual env var
// value, so a real contact email or curation key can't end up in console
// output or the (gitignored, but still local) log file.
function describeEnvVar(name, currentValue, defaultValue) {
  if (currentValue === undefined || currentValue === "" || currentValue === defaultValue) {
    return `${name}: not set (using default)`;
  }
  return `${name}: set (custom value, ${currentValue.length} chars)`;
}

async function countRawRunFiles(dir) {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((f) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}

async function runDryRun(log) {
  log("=".repeat(60));
  log("refresh:incremental DRY RUN - no network calls, no AI calls, no data/processed writes.");
  log("=".repeat(60));

  log("");
  log("Config:");
  log(`  ${describeEnvVar("OPENALEX_EMAIL", process.env.OPENALEX_EMAIL, undefined)} (used for OpenAlex's polite pool - OpenAlex itself needs no API key)`);
  log(`  ${describeEnvVar("OPENALEX_INCREMENTAL_PAGES_PER_QUERY", process.env.OPENALEX_INCREMENTAL_PAGES_PER_QUERY, undefined)}`);
  log(`  AI_CURATION configured: ${isCurationConfigured()} ${isCurationConfigured() ? "" : "(AI_CURATION_API_URL/AI_CURATION_API_KEY not set - not on this pipeline's path anyway; only curate:images reads them)"}`);
  log(`  Effective OpenAlex contact identifier in use: ${OPENALEX_EMAIL === "research-demo@example.invalid" ? "placeholder default (research-demo@example.invalid)" : "custom (set via OPENALEX_EMAIL)"}`);

  log("");
  log("Available sources:");
  const rawOpenAlexDir = path.join(rootDir, "data/raw/openalex");
  const rawRunFileCount = await countRawRunFiles(rawOpenAlexDir);
  log(`  data/raw/openalex/: ${rawRunFileCount} existing raw run file(s) on disk`);
  const researchRecordsData = await readJsonIfExists(path.join(processedDir, "research-records.json"));
  log(`  data/processed/research-records.json: ${researchRecordsData ? `present, ${researchRecordsData.records?.length ?? 0} record(s)` : "MISSING"}`);
  const displayRecordsData = await readJsonIfExists(path.join(processedDir, "display-records.json"));
  log(`  data/processed/display-records.json: ${displayRecordsData ? `present, ${displayRecordsData.records?.length ?? 0} record(s)` : "MISSING"}`);

  log("");
  log("Last update status:");
  const previousStatus = await readJsonIfExists(updateStatusPath);
  if (previousStatus) {
    log(`  status=${previousStatus.status ?? "unknown"} lastSuccessfulRefreshAt=${previousStatus.lastSuccessfulRefreshAt || "(never)"} lastAttemptedRefreshAt=${previousStatus.lastAttemptedRefreshAt || "(never)"}`);
  } else {
    log("  data/processed/update-status.json does not exist yet - no prior run recorded.");
  }

  log("");
  log("A live run (no --dry-run) would, inside a temp dir, only promoting on full success:");
  log("  1/10 fetch:global-updates (real OpenAlex network call, incremental window)");
  log("  2/10 process:records (into temp dir)");
  log("  3/10 compare:records (classify new/updated/unchanged/duplicate/needs_manual_review)");
  log("  4/10 triage:records - pass 1 (into temp dir)");
  log("  5/10 queue:enrichment (into temp dir)");
  log("  6/10 enrich:images (real network calls to each queued record's own source URL(s))");
  log("  7/10 triage:records - pass 2 (into temp dir)");
  log("  8/10 enrich:explanations (heuristic/template only - no AI call)");
  log("  9/10 build:country-profiles (into temp dir)");
  log("  10/10 verify:data-provenance + verify:display-eligibility (against temp dir) - only if both pass, promote into data/processed/");
  log("");
  log("Dry run complete - nothing was fetched, generated, or written to data/processed/.");

  return {
    dryRun: true,
    rawRunFileCount,
    researchRecordsPresent: Boolean(researchRecordsData),
    displayRecordsPresent: Boolean(displayRecordsData),
    aiCurationConfigured: isCurationConfigured(),
    lastStatus: previousStatus,
  };
}

export async function refreshIncremental({ dryRun = false } = {}) {
  if (dryRun) {
    return withLogging((log) => runDryRun(log));
  }

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
      const queueResult = await queueImageEnrichment({ processedDir: tempDir, nowIso: attemptedAt });
      log(`  ${queueResult.queuedCount} record(s) queued (${queueResult.totalCandidatesConsidered} candidate(s) considered, ${queueResult.skippedCooldown} skipped on cooldown)`);

      log("Step 6/10: enrich:images (into temp dir)");
      const imagesResult = await enrichImages({ processedDir: tempDir, nowIso: attemptedAt });
      log(`  attempted ${imagesResult.attempted}, given new images ${imagesResult.recordsGivenImages}, still pending ${imagesResult.recordsStillPending}`);

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
  const dryRun = process.argv.slice(2).includes("--dry-run");
  await refreshIncremental({ dryRun });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during refresh:incremental:", error.message);
    process.exitCode = 1;
  });
}
