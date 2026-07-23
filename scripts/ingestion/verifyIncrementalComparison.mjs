import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareRecords, writeComparisonOutputFiles } from "./compareRecords.mjs";

// Proves the incremental-comparison system actually works, using a fully
// controlled fixture (data/test/incoming-records-sample.json) rather than
// the live, ever-changing research-records.json: a new record, an updated
// one, an unchanged one, a duplicate pair, and a needs_manual_review
// (weak-match-only) case must all classify correctly, and must land in the
// right output file.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const fixturePath = path.join(rootDir, "data/test/incoming-records-sample.json");
// Test-only output - deliberately NOT data/processed/ directly. A
// verification command must never leave the real data/processed/*.json
// comparison files (compare-report.json etc.) in fixture-test state; only
// npm run compare:records (no --test) is allowed to write those.
const testOutputDir = path.join(rootDir, "data/processed/test/incremental-comparison");

const REQUIRED_RESULT_FIELDS = ["recordId", "classification", "matchMethod", "confidence", "reason", "incomingHash"];
const REQUIRED_SCENARIOS = ["new", "updated", "unchanged", "duplicate", "needs_manual_review"];

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifyIncrementalComparison() {
  const failures = [];
  const warnings = [];

  const fixture = await readJsonIfExists(fixturePath);
  if (!fixture) {
    return {
      ok: false,
      failures: [`Test fixture not found or unreadable: ${path.relative(rootDir, fixturePath)}`],
      warnings: [],
      counts: {},
    };
  }

  const existingRecords = fixture.existingRecords ?? [];
  const incomingRecords = fixture.incomingRecords ?? [];
  const results = compareRecords(incomingRecords, existingRecords);
  const nowIso = new Date().toISOString();

  // Regenerates the four files fresh from the fixture on every run, so this
  // check never passes on stale output left over from a previous run - but
  // always into testOutputDir, never data/processed/ directly.
  await writeComparisonOutputFiles(incomingRecords, results, { outputDir: testOutputDir, nowIso });

  const filePaths = {
    "compare-report.json": path.join(testOutputDir, "compare-report.json"),
    "records-for-processing.json": path.join(testOutputDir, "records-for-processing.json"),
    "skipped-records.json": path.join(testOutputDir, "skipped-records.json"),
    "conflict-records.json": path.join(testOutputDir, "conflict-records.json"),
  };
  const fileContents = {};
  for (const [name, filePath] of Object.entries(filePaths)) {
    const content = await readJsonIfExists(filePath);
    if (!content) {
      failures.push(`${name} does not exist or is unreadable at ${path.relative(rootDir, filePath)}.`);
    }
    fileContents[name] = content;
  }

  // Every one of the 5 required scenarios must actually appear in this
  // fixture's results - a fixture that's missing one silently proves
  // nothing about that code path.
  const classificationsPresent = new Set(results.map((r) => r.classification));
  REQUIRED_SCENARIOS.forEach((scenario) => {
    if (!classificationsPresent.has(scenario)) {
      failures.push(`Fixture does not produce a "${scenario}" classification - test fixture is incomplete.`);
    }
  });

  // Each fixture record's actual classification must match what the
  // fixture itself declares as expected (data/test/incoming-records-
  // sample.json's expectedClassifications map) - catches both a broken
  // comparator and a fixture that stopped testing what it claims to.
  const resultsById = new Map(results.map((r) => [r.recordId, r]));
  Object.entries(fixture.expectedClassifications ?? {}).forEach(([recordId, expected]) => {
    const actual = resultsById.get(recordId);
    if (!actual) {
      failures.push(`Fixture record ${recordId} (expected "${expected}") produced no comparison result at all.`);
      return;
    }
    if (actual.classification !== expected) {
      failures.push(`Fixture record ${recordId}: expected classification "${expected}", got "${actual.classification}".`);
    }
  });

  const forProcessingIds = new Set((fileContents["records-for-processing.json"]?.records ?? []).map((r) => r.recordId));
  const skippedIds = new Set((fileContents["skipped-records.json"]?.records ?? []).map((r) => r.recordId));
  const conflictIds = new Set((fileContents["conflict-records.json"]?.records ?? []).map((r) => r.recordId));

  results.forEach((result) => {
    const { recordId, classification } = result;
    const isNewOrUpdated = classification === "new" || classification === "updated";
    const isUnchangedOrDuplicate = classification === "unchanged" || classification === "duplicate";
    const isConflict = classification === "needs_manual_review" || classification === "conflict";

    if (isNewOrUpdated && !forProcessingIds.has(recordId)) {
      failures.push(`Record ${recordId} (${classification}) is missing from records-for-processing.json.`);
    }
    if (isUnchangedOrDuplicate && forProcessingIds.has(recordId)) {
      failures.push(`Record ${recordId} (${classification}) must NOT appear in records-for-processing.json.`);
    }
    if (isUnchangedOrDuplicate && !skippedIds.has(recordId)) {
      failures.push(`Record ${recordId} (${classification}) is missing from skipped-records.json.`);
    }
    if (isConflict && !conflictIds.has(recordId)) {
      failures.push(`Record ${recordId} (${classification}) is missing from conflict-records.json.`);
    }

    REQUIRED_RESULT_FIELDS.forEach((field) => {
      if (result[field] === undefined || result[field] === null) {
        failures.push(`Result for ${recordId} is missing required field "${field}".`);
      }
    });
    // existingHash is "where applicable" - required whenever the match is
    // against an EXISTING record (updated/unchanged/needs_manual_review).
    // "duplicate"'s matchedRecordId points at a sibling INCOMING record,
    // not an existing one, so there is no existing-side hash to report.
    const matchesAnExistingRecord = classification === "updated" || classification === "unchanged" || isConflict;
    if (matchesAnExistingRecord && (result.existingHash === undefined || result.existingHash === null)) {
      failures.push(`Result for ${recordId} (${classification}) is matched against an existing record but has no existingHash.`);
    }
  });

  const counts = results.reduce((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});

  return { ok: failures.length === 0, failures, warnings, counts };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Incremental Comparison Verification");
  console.log("=".repeat(60));
  console.log(`Fixture:    ${path.relative(rootDir, fixturePath)}`);
  console.log(`Output dir: ${path.relative(rootDir, testOutputDir)} (test-only, never data/processed/*.json directly)`);
  REQUIRED_SCENARIOS.forEach((scenario) => {
    console.log(`  ${scenario}: ${result.counts[scenario] ?? 0}`);
  });

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
  const result = await verifyIncrementalComparison();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:incremental-comparison:", error);
    process.exitCode = 1;
  });
}
