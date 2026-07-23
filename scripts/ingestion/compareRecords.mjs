import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeRecordHash } from "../processing/normalizeResearchRecord.mjs";

// Classifies incoming (freshly fetched/normalized) records against the
// existing dataset so process:records only spends enrichment effort on
// records that are actually new or actually changed - re-processing 329
// unchanged records every run would be wasted API calls and wasted
// image-fetch attempts against sites that already told us no.
//
// Matches by stable keys first (DOI, OpenAlex work id, CORDIS project id,
// source URL) - any one shared stable key is treated as the same record.
// Falls back to a weak key (normalized title + institution + year) ONLY
// when there is also at least one overlapping stable key, to avoid two
// coincidentally similarly-titled papers being silently merged; a weak-key
// match with NO stable-key overlap is flagged needs_manual_review instead
// of being guessed either way.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const processedDir = path.join(rootDir, "data/processed");
const defaultFixturePath = path.join(rootDir, "data/test/incoming-records-sample.json");
// --test runs (fixture data, not the real dataset) default here, NEVER to
// processedDir directly - a verification command must not leave the real
// data/processed/*.json comparison files in fixture-test state.
const defaultTestOutputDir = path.join(rootDir, "data/processed/test/incremental-comparison");

function normalizeTitleKey(title) {
  return (title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stableKeys(record) {
  const keys = [];
  if (record.doi) keys.push(`doi:${record.doi.toLowerCase()}`);
  if (record.openAlexUrl) keys.push(`openalex:${record.openAlexUrl.toLowerCase()}`);
  const cordisMatch = /cordis-(\d+)/.exec(record.recordId ?? "");
  if (cordisMatch) keys.push(`cordis:${cordisMatch[1]}`);
  (record.sourceUrls ?? []).forEach((url) => keys.push(`url:${url.toLowerCase()}`));
  return keys;
}

function weakKey(record) {
  const year = String(record.publicationDate || record.extractedAt || "").slice(0, 4);
  const institution = (record.institution || record.coordinator || "").toLowerCase();
  return `title:${normalizeTitleKey(record.title)}|inst:${institution}|year:${year}`;
}

const MATCH_METHOD_LABELS = {
  doi: "doi",
  openalex: "openAlexId",
  cordis: "cordisId",
  url: "sourceUrl",
};

function matchMethodForKey(key) {
  const prefix = key.split(":")[0];
  return MATCH_METHOD_LABELS[prefix] ?? "unknown";
}

/**
 * @returns {Array<{
 *   recordId: string,
 *   classification: "new"|"updated"|"unchanged"|"duplicate"|"needs_manual_review",
 *   matchedRecordId: string|null,
 *   matchMethod: "doi"|"openAlexId"|"cordisId"|"sourceUrl"|"normalized_title_institution_year"|"duplicate_within_batch"|"none",
 *   confidence: number,
 *   reason: string,
 *   incomingHash: string,
 *   existingHash: string|null,
 * }>}
 */
export function compareRecords(incomingRecords, existingRecords) {
  const existingByStableKey = new Map();
  const existingByWeakKey = new Map();
  existingRecords.forEach((record) => {
    stableKeys(record).forEach((key) => existingByStableKey.set(key, record));
    existingByWeakKey.set(weakKey(record), record);
  });

  // Maps each stable key already seen in THIS incoming batch to whichever
  // incoming record first claimed it, so a later duplicate can report who
  // it duplicates.
  const seenIncomingStableKeys = new Map();
  const results = [];

  for (const incoming of incomingRecords) {
    const keys = stableKeys(incoming);
    const incomingHash = incoming.recordHash ?? computeRecordHash(incoming);

    const duplicateKey = keys.find((key) => seenIncomingStableKeys.has(key));
    keys.forEach((key) => {
      if (!seenIncomingStableKeys.has(key)) seenIncomingStableKeys.set(key, incoming.recordId);
    });

    if (duplicateKey) {
      const matchMethod = matchMethodForKey(duplicateKey);
      results.push({
        recordId: incoming.recordId,
        classification: "duplicate",
        matchedRecordId: seenIncomingStableKeys.get(duplicateKey),
        matchMethod: "duplicate_within_batch",
        confidence: 100,
        reason: `Duplicate of another incoming record sharing the same ${matchMethod}.`,
        incomingHash,
        existingHash: null,
      });
      continue;
    }

    const matchedKey = keys.find((key) => existingByStableKey.has(key));
    let matched = matchedKey ? existingByStableKey.get(matchedKey) : null;
    let matchMethod = matchedKey ? matchMethodForKey(matchedKey) : null;

    if (!matched) {
      const weakMatch = existingByWeakKey.get(weakKey(incoming));
      if (weakMatch) {
        const overlapKey = stableKeys(weakMatch).find((key) => keys.includes(key));
        if (overlapKey) {
          matched = weakMatch;
          matchMethod = matchMethodForKey(overlapKey);
        } else {
          const existingHash = weakMatch.recordHash ?? computeRecordHash(weakMatch);
          results.push({
            recordId: incoming.recordId,
            classification: "needs_manual_review",
            matchedRecordId: weakMatch.recordId,
            matchMethod: "normalized_title_institution_year",
            confidence: 40,
            reason:
              "Matched only by normalized title/institution/year with no overlapping DOI/OpenAlex/CORDIS/source URL - could be a coincidental title match, could be the same record recorded with different identifiers.",
            incomingHash,
            existingHash,
          });
          continue;
        }
      }
    }

    if (!matched) {
      results.push({
        recordId: incoming.recordId,
        classification: "new",
        matchedRecordId: null,
        matchMethod: "none",
        confidence: 100,
        reason: "No matching DOI/OpenAlex id/CORDIS id/source URL/title+institution+year found in existing records.",
        incomingHash,
        existingHash: null,
      });
      continue;
    }

    const existingHash = matched.recordHash ?? computeRecordHash(matched);
    const unchanged = incomingHash === existingHash;
    results.push({
      recordId: incoming.recordId,
      classification: unchanged ? "unchanged" : "updated",
      matchedRecordId: matched.recordId,
      matchMethod,
      confidence: 100,
      reason: unchanged
        ? `Matched an existing record by ${matchMethod} with an identical content hash - nothing to re-process.`
        : `Matched an existing record by ${matchMethod} but the content hash differs - needs re-processing.`,
      incomingHash,
      existingHash,
    });
  }

  return results;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

// Writes filePath only if its content actually changed (comparing
// everything EXCEPT generatedAt, which ticks over on every run
// regardless). Without this, a repeat run with no real change would still
// rewrite every file with a fresh timestamp and show up as a git diff for
// no actual reason - exactly the "unchanged data still looks modified"
// problem incremental comparison exists to avoid, applied to its own
// output files.
async function writeIfChanged(filePath, content) {
  const { generatedAt: _ignored, ...rest } = content;
  const existing = await readJsonIfExists(filePath);
  if (existing) {
    const { generatedAt: _existingIgnored, ...existingRest } = existing;
    if (JSON.stringify(existingRest) === JSON.stringify(rest)) {
      return false;
    }
  }
  await fs.writeFile(filePath, `${JSON.stringify(content, null, 2)}\n`);
  return true;
}

// Splits incoming records by classification into the three files
// process:records/refresh:incremental (and this script's own CLI) act on:
//   records-for-processing.json - new + updated, the only ones worth
//                                  spending real enrichment effort on.
//   skipped-records.json        - unchanged + duplicate, deliberately
//                                  left alone this run.
//   conflict-records.json       - needs_manual_review (or any future
//                                  "conflict" classification), held for a
//                                  human to resolve rather than guessed.
// compare-report.json is the full per-record classification list
// regardless of bucket, for auditing.
export async function writeComparisonOutputFiles(
  incomingRecords,
  results,
  { outputDir = processedDir, nowIso = new Date().toISOString() } = {}
) {
  const byRecordId = new Map(incomingRecords.map((record) => [record.recordId, record]));
  const counts = results.reduce((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});

  const forProcessing = results
    .filter((r) => r.classification === "new" || r.classification === "updated")
    .map((r) => byRecordId.get(r.recordId))
    .filter(Boolean);
  const skipped = results
    .filter((r) => r.classification === "unchanged" || r.classification === "duplicate")
    .map((r) => byRecordId.get(r.recordId))
    .filter(Boolean);
  const conflictResults = results.filter(
    (r) => r.classification === "needs_manual_review" || r.classification === "conflict"
  );
  const conflicts = conflictResults.map((r) => byRecordId.get(r.recordId)).filter(Boolean);

  await fs.mkdir(outputDir, { recursive: true });
  const writes = await Promise.all([
    writeIfChanged(path.join(outputDir, "compare-report.json"), { generatedAt: nowIso, counts, results }),
    writeIfChanged(path.join(outputDir, "records-for-processing.json"), {
      generatedAt: nowIso,
      recordCount: forProcessing.length,
      records: forProcessing,
    }),
    writeIfChanged(path.join(outputDir, "skipped-records.json"), {
      generatedAt: nowIso,
      recordCount: skipped.length,
      records: skipped,
    }),
    writeIfChanged(path.join(outputDir, "conflict-records.json"), {
      generatedAt: nowIso,
      recordCount: conflicts.length,
      records: conflicts,
      results: conflictResults,
    }),
  ]);

  return {
    counts,
    forProcessingCount: forProcessing.length,
    skippedCount: skipped.length,
    conflictCount: conflicts.length,
    filesWritten: writes.filter(Boolean).length,
  };
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      args[arg.slice(2)] = true;
    } else {
      args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
    }
  }
  return args;
}

function printSummary(results, summary, outputDir) {
  const counts = summary.counts;
  console.log("\n" + "=".repeat(60));
  console.log("Compare Records Summary");
  console.log("=".repeat(60));
  console.log(`Incoming records checked: ${results.length}`);
  ["new", "updated", "unchanged", "duplicate", "needs_manual_review"].forEach((key) => {
    console.log(`  ${key}: ${counts[key] ?? 0}`);
  });
  console.log(`records-for-processing.json: ${summary.forProcessingCount} record(s)`);
  console.log(`skipped-records.json:        ${summary.skippedCount} record(s)`);
  console.log(`conflict-records.json:       ${summary.conflictCount} record(s)`);
  console.log(`Reports written to ${path.relative(rootDir, outputDir)}`);
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const nowIso = new Date().toISOString();
  const explicitOutputDir = args["output-dir"] ? path.resolve(args["output-dir"]) : null;

  // Test-fixture mode: npm run compare:records -- --input=<path> --test
  // Reads one file shaped {existingRecords, incomingRecords} instead of two
  // separate {records} files - used by verify:incremental-comparison. Always
  // writes to a test-only directory (never processedDir directly) unless
  // --output-dir explicitly overrides it, so a fixture run can never leave
  // the real data/processed/*.json comparison files in test state.
  if (args.test) {
    const fixturePath = args.input ? path.resolve(args.input) : defaultFixturePath;
    const fixture = await readJsonIfExists(fixturePath);
    if (!fixture) {
      throw new Error(`Test fixture not found: ${fixturePath}`);
    }
    const outputDir = explicitOutputDir ?? defaultTestOutputDir;
    const incomingRecords = fixture.incomingRecords ?? [];
    const results = compareRecords(incomingRecords, fixture.existingRecords ?? []);
    const summary = await writeComparisonOutputFiles(incomingRecords, results, { outputDir, nowIso });
    printSummary(results, summary, outputDir);
    return;
  }

  const outputDir = explicitOutputDir ?? processedDir;
  const existingPath = args.existing ? path.resolve(args.existing) : path.join(processedDir, "research-records.json");
  const incomingArg = args.incoming ?? args.input;
  const incomingPath = incomingArg ? path.resolve(incomingArg) : existingPath;

  const existingData = await readJsonIfExists(existingPath);
  const incomingData = await readJsonIfExists(incomingPath);

  if (!existingData) {
    throw new Error(`Existing records file not found: ${existingPath}`);
  }
  if (!incomingData) {
    throw new Error(`Incoming records file not found: ${incomingPath}. Pass --input=<path>.`);
  }

  const incomingRecords = incomingData.records ?? [];
  const results = compareRecords(incomingRecords, existingData.records ?? []);
  const summary = await writeComparisonOutputFiles(incomingRecords, results, { outputDir, nowIso });
  printSummary(results, summary, outputDir);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during compare:records:", error);
    process.exitCode = 1;
  });
}
