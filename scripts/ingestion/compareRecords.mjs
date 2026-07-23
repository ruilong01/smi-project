import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeRecordHash } from "../processing/normalizeResearchRecord.mjs";

// Classifies incoming (freshly fetched/normalized) records against the
// existing dataset so refresh:incremental only spends enrichment effort on
// records that are actually new or actually changed - re-processing 329
// unchanged records every weekday morning would be wasted API calls and
// wasted image-fetch attempts against sites that already told us no.
//
// Matches by stable keys first (DOI, OpenAlex work id, CORDIS project id,
// source URL) - any one shared stable key is treated as the same record.
// Falls back to a weak key (normalized title + institution + year) ONLY
// when there is also at least one overlapping stable key, to avoid two
// coincidentally similarly-titled papers being silently merged.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const processedDir = path.join(rootDir, "data/processed");

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

/**
 * @returns {Array<{recordId, classification: "new"|"updated"|"unchanged"|"duplicate"|"conflict"|"needs_manual_review", matchedRecordId, reason?}>}
 */
export function compareRecords(incomingRecords, existingRecords) {
  const existingByStableKey = new Map();
  const existingByWeakKey = new Map();
  existingRecords.forEach((record) => {
    stableKeys(record).forEach((key) => existingByStableKey.set(key, record));
    existingByWeakKey.set(weakKey(record), record);
  });

  const seenIncomingStableKeys = new Set();
  const results = [];

  for (const incoming of incomingRecords) {
    const keys = stableKeys(incoming);
    const isDuplicateWithinBatch = keys.some((key) => seenIncomingStableKeys.has(key));
    keys.forEach((key) => seenIncomingStableKeys.add(key));

    if (isDuplicateWithinBatch) {
      results.push({ recordId: incoming.recordId, classification: "duplicate", matchedRecordId: null });
      continue;
    }

    let matched = keys.map((key) => existingByStableKey.get(key)).find(Boolean) ?? null;

    if (!matched) {
      const weakMatch = existingByWeakKey.get(weakKey(incoming));
      if (weakMatch) {
        const hasOverlap = stableKeys(weakMatch).some((key) => keys.includes(key));
        if (hasOverlap) {
          matched = weakMatch;
        } else {
          results.push({
            recordId: incoming.recordId,
            classification: "needs_manual_review",
            matchedRecordId: weakMatch.recordId,
            reason:
              "Matched only by normalized title/institution/year with no overlapping DOI/OpenAlex/CORDIS/source URL.",
          });
          continue;
        }
      }
    }

    if (!matched) {
      results.push({ recordId: incoming.recordId, classification: "new", matchedRecordId: null });
      continue;
    }

    const incomingHash = incoming.recordHash ?? computeRecordHash(incoming);
    const existingHash = matched.recordHash ?? computeRecordHash(matched);
    results.push({
      recordId: incoming.recordId,
      classification: incomingHash === existingHash ? "unchanged" : "updated",
      matchedRecordId: matched.recordId,
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

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const existingPath = args.existing ? path.resolve(args.existing) : path.join(processedDir, "research-records.json");
  const incomingPath = args.incoming ? path.resolve(args.incoming) : existingPath;

  const existingData = await readJsonIfExists(existingPath);
  const incomingData = await readJsonIfExists(incomingPath);

  if (!existingData) {
    throw new Error(`Existing records file not found: ${existingPath}`);
  }
  if (!incomingData) {
    throw new Error(`Incoming records file not found: ${incomingPath}. Pass --incoming <path>.`);
  }

  const results = compareRecords(incomingData.records ?? [], existingData.records ?? []);
  const counts = results.reduce((acc, r) => {
    acc[r.classification] = (acc[r.classification] ?? 0) + 1;
    return acc;
  }, {});

  const reportPath = path.join(processedDir, "compare-report.json");
  await fs.writeFile(
    reportPath,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), counts, results }, null, 2)}\n`
  );

  console.log("\n" + "=".repeat(60));
  console.log("Compare Records Summary");
  console.log("=".repeat(60));
  console.log(`Incoming records checked: ${results.length}`);
  ["new", "updated", "unchanged", "duplicate", "conflict", "needs_manual_review"].forEach((key) => {
    console.log(`  ${key}: ${counts[key] ?? 0}`);
  });
  console.log(`Report written to ${path.relative(rootDir, reportPath)}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during compare:records:", error);
    process.exitCode = 1;
  });
}
