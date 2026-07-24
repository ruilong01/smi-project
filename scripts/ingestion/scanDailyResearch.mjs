import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverResearchGlobal } from "./discoverResearchGlobal.mjs";

// Phase 3 of the global research scanner - a "daily scan" SCAFFOLD only.
// No scheduler is installed anywhere by this file; it is a plain script a
// human (or, later, a real cron job someone deliberately sets up) runs
// manually. Defaults to dry-run - an explicit --live flag is required to
// even attempt the (still staging-only) discovery write, and there is no
// path in this file that ever touches data/processed/research-records.json
// or display-records.json. Its own run-status output goes to a test-only
// location, same convention as every other staging file in this pipeline.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const statusPath = path.join(rootDir, "data/processed/test/daily-scan-status.json");

const DEFAULT_LIMIT = 20;

function nowIso() {
  return new Date().toISOString();
}

export async function scanDailyResearch({ limit = DEFAULT_LIMIT, dryRun = true, log = console.log } = {}) {
  const startedAt = nowIso();
  log(`Daily research scan starting (${dryRun ? "DRY RUN" : "live, staging-only"}) at ${startedAt}`);

  let discoveryResult = null;
  let error = null;
  try {
    discoveryResult = await discoverResearchGlobal({ limit, dryRun, log });
  } catch (err) {
    error = err.message;
    log(`  Scan pass failed: ${err.message}`);
  }

  const status = {
    generatedAt: nowIso(),
    command: "scan:daily-research",
    isTestOutput: true,
    dryRun,
    startedAt,
    completedAt: nowIso(),
    limit,
    schedulerInstalled: false,
    error,
    discoverySummary: discoveryResult
      ? {
          searchPassesRun: discoveryResult.searchPassesRun,
          candidatesFound: discoveryResult.candidatesFound,
          newCandidateCount: discoveryResult.newCandidateCount,
          duplicateCount: discoveryResult.duplicateCount,
          reviewCount: discoveryResult.reviewCount,
          countriesTargeted: discoveryResult.countriesTargeted,
        }
      : null,
  };

  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);

  return status;
}

function parseArgs(argv) {
  const args = { limit: DEFAULT_LIMIT, dryRun: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--live") args.dryRun = false;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const status = await scanDailyResearch({ limit: args.limit, dryRun: args.dryRun });

  console.log("\n" + "=".repeat(60));
  console.log("Daily Research Scan Summary");
  console.log("=".repeat(60));
  console.log(`Mode:              ${status.dryRun ? "DRY RUN" : "live (staging-only)"}`);
  console.log(`Scheduler installed: ${status.schedulerInstalled}`);
  if (status.error) {
    console.log(`Error:             ${status.error}`);
  } else if (status.discoverySummary) {
    console.log(`Candidates found:  ${status.discoverySummary.candidatesFound}`);
    console.log(`  New:             ${status.discoverySummary.newCandidateCount}`);
    console.log(`  Duplicates:      ${status.discoverySummary.duplicateCount}`);
  }
  console.log(`Status written to: ${path.relative(rootDir, statusPath)}`);
  console.log("=".repeat(60) + "\n");

  if (status.error) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during scan:daily-research:", error);
    process.exitCode = 1;
  });
}
