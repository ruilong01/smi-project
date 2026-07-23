import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchOpenAlexRaw } from "./fetchOpenAlex.mjs";
import { processRecords } from "./processRecords.mjs";
import { buildCountryProfiles } from "./buildCountryProfiles.mjs";
import { verify } from "./verifyDataProvenance.mjs";

// The full pipeline: fetch:openalex -> process:records -> build:country-
// profiles -> verify:data-provenance, with atomic write semantics.
//
// New processed output is built entirely in a temp directory first. Only
// if verify:data-provenance passes against that temp output does it
// replace the live data/processed/ files - so a bad or empty fetch can
// NEVER take down the dataset users are currently seeing. update-
// status.json (in the real, live directory) is only ever updated to
// "success" after that swap succeeds.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const processedDir = path.join(rootDir, "data/processed");
const logsDir = path.join(rootDir, "data/logs");
const logFilePath = path.join(logsDir, "data-refresh.log");
const updateStatusPath = path.join(processedDir, "update-status.json");

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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readActiveRecordIds() {
  const data = await readJsonIfExists(path.join(processedDir, "research-records.json"));
  return new Set((data?.records ?? []).map((r) => r.recordId));
}

async function writeUpdateStatus(status) {
  await fs.mkdir(processedDir, { recursive: true });
  await fs.writeFile(updateStatusPath, `${JSON.stringify(status, null, 2)}\n`);
}

async function moveTempIntoPlace(tempDir) {
  for (const fileName of ["research-records.json", "country-profiles.json"]) {
    await fs.copyFile(path.join(tempDir, fileName), path.join(processedDir, fileName));
  }
}

export async function refreshData() {
  return withLogging(async (log) => {
    const attemptedAt = nowStamp();
    const previous = await readJsonIfExists(updateStatusPath);
    const previousRecordIds = await readActiveRecordIds();

    log("=".repeat(60));
    log("refresh:data starting");
    log("=".repeat(60));

    const errors = [];
    const tempDir = path.join(processedDir, `.tmp-refresh-${Date.now()}`);

    let fetchResult = null;
    let processResult = null;
    let countryResult = null;
    let verifyResult = null;

    try {
      log("Step 1/4: fetch:openalex");
      fetchResult = await fetchOpenAlexRaw({ nowIso: attemptedAt });
      log(`  fetched ${fetchResult.workCount} works -> ${fetchResult.relativeRawFilePath}`);

      if (fetchResult.workCount === 0) {
        throw new Error(
          "OpenAlex fetch returned zero works across all queries - treating as a failure, not a quiet day, per refresh:data policy."
        );
      }

      log("Step 2/4: process:records (writing to temp dir)");
      processResult = await processRecords({ outputDir: tempDir, nowIso: attemptedAt });
      log(`  kept ${processResult.recordCount} records, dropped ${processResult.droppedCount}`);

      log("Step 3/4: build:country-profiles (writing to temp dir)");
      countryResult = await buildCountryProfiles({
        inputDir: tempDir,
        outputDir: tempDir,
        nowIso: attemptedAt,
      });
      log(`  built ${countryResult.countryCount} country profiles`);

      log("Step 4/4: verify:data-provenance (against temp dir)");
      verifyResult = await verify({ processedDir: tempDir });
      if (!verifyResult.ok) {
        throw new Error(`Verification failed: ${verifyResult.failures.join("; ")}`);
      }
      log(`  verification passed: ${verifyResult.counts.total} records, ${verifyResult.countryCount} countries`);

      log("Verification passed - swapping temp output into data/processed/");
      await moveTempIntoPlace(tempDir);

      const newRecordIds = new Set(
        (await readJsonIfExists(path.join(tempDir, "research-records.json")))?.records?.map(
          (r) => r.recordId
        ) ?? []
      );
      const recordsAdded = [...newRecordIds].filter((id) => !previousRecordIds.has(id)).length;
      const recordsUpdated = [...newRecordIds].filter((id) => previousRecordIds.has(id)).length;
      const status = {
        lastSuccessfulFetchAt: attemptedAt,
        lastAttemptedFetchAt: attemptedAt,
        lastSource: "openalex",
        recordsFetched: fetchResult.workCount,
        recordsProcessed: processResult.recordCount,
        recordsAdded,
        recordsUpdated,
        duplicatesSkipped: fetchResult.workCount - processResult.recordCount,
        frontendDataUpdatedAt: attemptedAt,
        status: "success",
        errors: [],
        countryCount: countryResult.countryCount,
        rawFile: fetchResult.relativeRawFilePath,
      };
      await writeUpdateStatus(status);
      log("refresh:data completed successfully.");
      return status;
    } catch (error) {
      errors.push(error.message);
      log(`refresh:data FAILED: ${error.message}`);
      log("Keeping previous processed dataset unchanged (data/processed/research-records.json and country-profiles.json were not touched).");

      const status = {
        lastSuccessfulFetchAt: previous?.lastSuccessfulFetchAt ?? "",
        lastAttemptedFetchAt: attemptedAt,
        lastSource: "openalex",
        recordsFetched: fetchResult?.workCount ?? 0,
        recordsProcessed: previous?.recordsProcessed ?? 0,
        recordsAdded: 0,
        recordsUpdated: 0,
        duplicatesSkipped: 0,
        frontendDataUpdatedAt: previous?.frontendDataUpdatedAt ?? "",
        status: "failed",
        errors,
        countryCount: previous?.countryCount ?? 0,
        rawFile: fetchResult?.relativeRawFilePath ?? null,
      };
      await writeUpdateStatus(status);
      throw error;
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
}

async function main() {
  await refreshData();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during refresh:data:", error.message);
    process.exitCode = 1;
  });
}
