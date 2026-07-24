import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Builds data/processed/source-discovery-queue.json: a small, prioritized
// batch of high-value imageless records worth spending real discovery
// effort on. Reads ONLY data/processed/pending-image-enrichment.json,
// which by construction already excludes rejected/mock/unverified/
// displayEligible/has-image records - the extra filters here narrow that
// down further to records with (a) a high enough score to be worth it and
// (b) enough structured metadata (acronym, coordinator, institutions, a
// CORDIS-style id, or a grant agreement id) to attempt safe, targeted
// discovery at all. A bare OpenAlex publication record with none of that
// has nothing for even a future search adapter to search FOR beyond its
// own title, so it's excluded rather than queued to "discover" nothing.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");

const HIGH_VALUE_SCORE_THRESHOLD = 70;
const DEFAULT_LIMIT = 10;

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function isHighValue(record) {
  return (record.relevanceScore ?? 0) >= HIGH_VALUE_SCORE_THRESHOLD || (record.actionabilityScore ?? 0) >= HIGH_VALUE_SCORE_THRESHOLD;
}

// "Enough project/institution metadata to search safely" - without this, a
// generic OpenAlex publication record (no acronym, no coordinator, no
// grant id) gives even a future real search adapter nothing distinctive to
// query for, and gives THIS pass's deterministic discovery (CORDIS sub-
// pages, OpenAIRE-by-grant-id) literally nothing to construct.
function hasEnoughMetadataForDiscovery(record) {
  if (record.recordType === "funded_project") return true;
  if (record.grantAgreementId) return true;
  if (record.acronym && (record.coordinator || record.institutions?.length)) return true;
  return false;
}

function priorityScore(record) {
  const isProjectRecord = record.recordType === "funded_project";
  const isCordisRecord = /cordis-/.test(record.recordId ?? "");
  const typeBonus = isProjectRecord ? 1000 : 0;
  const cordisBonus = isCordisRecord ? 500 : 0;
  const scoreSum = (record.relevanceScore ?? 0) + (record.actionabilityScore ?? 0);
  return typeBonus + cordisBonus + scoreSum;
}

function queueReasonFor(record) {
  const reasons = [];
  if (record.recordType === "funded_project") reasons.push("funded project record (preferred over generic publications)");
  if (/cordis-/.test(record.recordId ?? "")) reasons.push("CORDIS project record");
  if ((record.relevanceScore ?? 0) >= HIGH_VALUE_SCORE_THRESHOLD) reasons.push(`high relevance score (${record.relevanceScore})`);
  if ((record.actionabilityScore ?? 0) >= HIGH_VALUE_SCORE_THRESHOLD) reasons.push(`high actionability score (${record.actionabilityScore})`);
  if (record.grantAgreementId) reasons.push("has a grant agreement ID (enables OpenAIRE lookup)");
  if (reasons.length === 0) reasons.push("has enough metadata for safe discovery but no other standout signal");
  return reasons.join("; ");
}

export async function queueSourceDiscovery({
  processedDir = defaultProcessedDir,
  limit = DEFAULT_LIMIT,
  nowIso = new Date().toISOString(),
} = {}) {
  const pendingData = await readJsonIfExists(path.join(processedDir, "pending-image-enrichment.json"), { records: [] });
  const records = pendingData.records ?? [];

  const eligible = records.filter((record) => isHighValue(record) && hasEnoughMetadataForDiscovery(record));
  const sorted = [...eligible].sort((a, b) => priorityScore(b) - priorityScore(a));

  const queue = sorted.slice(0, limit).map((record) => ({
    recordId: record.recordId,
    title: record.title ?? "",
    acronym: record.acronym ?? "",
    recordType: record.recordType ?? "",
    sourceUrls: record.sourceUrls?.length ? record.sourceUrls : record.sourceUrl ? [record.sourceUrl] : [],
    countryOrRegion: record.countryOrRegion ?? "",
    institutions: record.institutions ?? [],
    coordinator: record.coordinator ?? "",
    topicPrimary: record.topicPrimary ?? "",
    relevanceScore: record.relevanceScore ?? 0,
    actionabilityScore: record.actionabilityScore ?? 0,
    grantAgreementId: record.grantAgreementId ?? "",
    queueReason: queueReasonFor(record),
    queuedAt: nowIso,
  }));

  const output = {
    generatedAt: nowIso,
    limit,
    totalPendingRecords: records.length,
    totalHighValueEligible: eligible.length,
    queuedCount: queue.length,
    queue,
  };

  await fs.mkdir(processedDir, { recursive: true });
  await fs.writeFile(
    path.join(processedDir, "source-discovery-queue.json"),
    `${JSON.stringify(output, null, 2)}\n`
  );

  return output;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit ? Number(args.limit) : DEFAULT_LIMIT;
  const result = await queueSourceDiscovery({ limit });

  console.log("\n" + "=".repeat(60));
  console.log("Source Discovery Queue Summary");
  console.log("=".repeat(60));
  console.log(`Limit:                        ${result.limit}`);
  console.log(`Total pending records:        ${result.totalPendingRecords}`);
  console.log(`High-value + searchable:      ${result.totalHighValueEligible}`);
  console.log(`Queued:                       ${result.queuedCount}`);
  console.log("Wrote data/processed/source-discovery-queue.json");
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during queue:source-discovery:", error);
    process.exitCode = 1;
  });
}
