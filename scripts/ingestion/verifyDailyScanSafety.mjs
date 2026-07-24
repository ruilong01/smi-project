import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Gate for scan:daily-research. Checks the script defaults to dry-run,
// never writes to production research-records.json/display-records.json,
// installs no scheduler/cron of any kind, and that its own status output
// lands only in a test/staging location.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const scriptPath = path.join(rootDir, "scripts/ingestion/scanDailyResearch.mjs");
const statusPath = path.join(rootDir, "data/processed/test/daily-scan-status.json");

const SCHEDULER_PATTERNS = /node-cron|node-schedule|setInterval|crontab|systemd|CronCreate/i;
const PRODUCTION_FILE_PATTERNS = /research-records\.json|display-records\.json/i;

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifyDailyScanSafety() {
  const failures = [];
  const warnings = [];

  const source = await readTextIfExists(scriptPath);
  if (!source) {
    failures.push(`${path.relative(rootDir, scriptPath)} does not exist.`);
    return { ok: false, failures, warnings, counts: {} };
  }

  // Comments are stripped before the code-safety checks below, so this
  // file's own explanatory prose (which necessarily NAMES the production
  // files it must never touch, and says "no scheduler") can't trigger a
  // false positive against itself.
  const codeOnly = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

  if (!/dryRun\s*=\s*true/.test(codeOnly)) {
    failures.push("scanDailyResearch.mjs does not default dryRun to true.");
  }
  if (SCHEDULER_PATTERNS.test(codeOnly)) {
    failures.push("scanDailyResearch.mjs contains scheduler/cron-related code - no scheduler may be installed by this scaffold.");
  }
  if (PRODUCTION_FILE_PATTERNS.test(codeOnly)) {
    failures.push("scanDailyResearch.mjs references research-records.json/display-records.json directly - it must only ever call the staging-only discovery function.");
  }
  if (!/schedulerInstalled:\s*false/.test(source)) {
    failures.push('scanDailyResearch.mjs status output must explicitly record schedulerInstalled: false.');
  }
  if (!source.includes(`${path.sep}test${path.sep}`) && !source.includes("data/processed/test")) {
    failures.push("scanDailyResearch.mjs's own status output does not appear to be under a data/processed/test/ staging path.");
  }

  // A status file, if present from a prior run, must itself say dry-run
  // unless someone explicitly passed --live, and must record no scheduler.
  const status = await readJsonIfExists(statusPath);
  if (status) {
    if (typeof status.dryRun !== "boolean") {
      failures.push("Existing daily-scan-status.json has a non-boolean dryRun field.");
    }
    if (status.schedulerInstalled !== false) {
      failures.push("Existing daily-scan-status.json does not record schedulerInstalled: false.");
    }
  } else {
    warnings.push("No daily-scan-status.json yet - run npm.cmd run scan:daily-research first for a live status check.");
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    counts: { lastRunWasDryRun: status?.dryRun ?? null },
  };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Daily Scan Safety Verification");
  console.log("=".repeat(60));
  console.log(`Last recorded run dryRun: ${result.counts.lastRunWasDryRun}`);
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.forEach((f) => console.log(`  ✗ ${f}`));
  } else {
    console.log("\nAll checks passed.");
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifyDailyScanSafety();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:daily-scan-safety:", error);
    process.exitCode = 1;
  });
}
