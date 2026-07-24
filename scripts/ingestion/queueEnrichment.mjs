import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifySourceUrls, CLASSIFIER_VERSION } from "../processing/imageSourceClassifier.mjs";

// Bump whenever this file's queueing logic (eligibility rules, cooldown,
// priority) meaningfully changes. Stamped onto the queue output so
// verify:image-enrichment can label a snapshot as current/stale instead of
// trusting an old queue file as if it reflects this code's current rules.
export const QUEUE_METHOD_VERSION = 2;

// Builds data/processed/image-enrichment-queue.json: a small, prioritized
// batch of records worth spending a real HTTP fetch on to look for an
// official/source-linked image. Never queues rejected/mock/unverified
// records, and never re-queues a record that already has an image or was
// attempted too recently (see RETRY_COOLDOWN_DAYS) - most failures are a
// page that will still be blocked/imageless tomorrow, so retrying it every
// single run wastes the very budget --limit exists to protect.
//
// Sources, in priority order (data/processed/pending-image-enrichment.json
// is the primary one - it's already exactly "real records with no image
// yet"; records-for-processing.json and research-records.json are
// secondary nets for anything not yet captured there):
//   1. pending-image-enrichment.json
//   2. records-for-processing.json (if it exists)
//   3. research-records.json - any remaining record with a sourceUrl but
//      no image candidate

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");

const HIGH_PRIORITY_THRESHOLD = 70;
const DEFAULT_LIMIT = 10;
// Don't retry a record's image fetch more than once every N days - most
// failures are a page that will still be blocked/unavailable tomorrow.
const RETRY_COOLDOWN_DAYS = 14;

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function recordSourceUrls(record) {
  return record.sourceUrls?.length ? record.sourceUrls : record.sourceUrl ? [record.sourceUrl] : [];
}

function alreadyHasImages(record) {
  return Boolean(record.hasImageCandidates) && (record.imageCandidateCount ?? 0) > 0;
}

// Never queue a record that isn't real, source-linked evidence to begin
// with (mirrors the same rule display eligibility itself enforces), AND -
// the fix this function exists for - never queue a record whose ONLY
// source URLs are a DOI redirect, a PDF, or a publisher article page.
// Those can never yield a real project image and fetching them wastes a
// request (and, per the retry bug this pass also fixed, used to waste
// several) on something that will predictably 403/404/redirect-away every
// single time. A record only enters the queue if at least one of its
// source URLs is fetch-allowed - see classifyImageSourceUrl.
function isEligibleForQueue(record) {
  if (!record) return false;
  if (record.verificationStatus === "mock_demo" || record.verificationStatus === "unverified") return false;
  if (record.processingStatus === "rejected") return false;
  const classifications = classifySourceUrls(recordSourceUrls(record));
  return classifications.some((c) => c.fetchAllowed);
}

function isInCooldown(record, nowIso) {
  if (!record.lastImageAttemptAt) return false;
  const elapsedMs = new Date(nowIso) - new Date(record.lastImageAttemptAt);
  return elapsedMs < RETRY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

function priorityScore(record) {
  const isProjectRecord = record.recordType === "funded_project";
  const isCordisRecord = /cordis-/.test(record.recordId ?? "");
  const typeBonus = isProjectRecord ? 1000 : 0;
  const cordisBonus = isCordisRecord ? 500 : 0;
  const scoreSum = (record.relevanceScore ?? 0) + (record.actionabilityScore ?? 0);
  return typeBonus + cordisBonus + scoreSum;
}

function queueReasonFor(record, fetchAllowedSourceUrls) {
  const reasons = [];
  if (record.recordType === "funded_project") reasons.push("funded project record (preferred over generic publications)");
  if (/cordis-/.test(record.recordId ?? "")) reasons.push("CORDIS project record (preferred over publisher-only records)");
  if ((record.relevanceScore ?? 0) >= HIGH_PRIORITY_THRESHOLD) reasons.push(`high relevance score (${record.relevanceScore})`);
  if ((record.actionabilityScore ?? 0) >= HIGH_PRIORITY_THRESHOLD) reasons.push(`high actionability score (${record.actionabilityScore})`);
  if (reasons.length === 0) reasons.push("has a real source URL but no image candidate yet");
  reasons.push(`${fetchAllowedSourceUrls.length} fetch-allowed source URL(s)`);
  return reasons.join("; ");
}

export async function queueImageEnrichment({
  processedDir = defaultProcessedDir,
  limit = DEFAULT_LIMIT,
  nowIso = new Date().toISOString(),
} = {}) {
  const pendingData = await readJsonIfExists(path.join(processedDir, "pending-image-enrichment.json"), { records: [] });
  const forProcessingData = await readJsonIfExists(path.join(processedDir, "records-for-processing.json"), { records: [] });
  const researchRecordsData = await readJsonIfExists(path.join(processedDir, "research-records.json"), { records: [] });

  const byRecordId = new Map();
  (pendingData.records ?? []).forEach((record) => byRecordId.set(record.recordId, record));
  (forProcessingData.records ?? []).forEach((record) => {
    if (!byRecordId.has(record.recordId) && !alreadyHasImages(record)) byRecordId.set(record.recordId, record);
  });
  (researchRecordsData.records ?? []).forEach((record) => {
    if (!byRecordId.has(record.recordId) && !alreadyHasImages(record) && isEligibleForQueue(record)) {
      byRecordId.set(record.recordId, record);
    }
  });

  const allCandidates = [...byRecordId.values()].filter(isEligibleForQueue).filter((r) => !alreadyHasImages(r));
  const skippedCooldown = allCandidates.filter((r) => isInCooldown(r, nowIso)).length;
  const eligibleNow = allCandidates.filter((r) => !isInCooldown(r, nowIso));
  const sorted = eligibleNow.sort((a, b) => priorityScore(b) - priorityScore(a));

  const queue = sorted.slice(0, limit).map((record) => {
    const sourceUrls = recordSourceUrls(record);
    const sourceUrlClassifications = classifySourceUrls(sourceUrls);
    const fetchAllowedSourceUrls = sourceUrlClassifications.filter((c) => c.fetchAllowed).map((c) => c.url);
    const blockedSourceUrls = sourceUrlClassifications.filter((c) => !c.fetchAllowed).map((c) => c.url);

    return {
      recordId: record.recordId,
      title: record.title ?? "",
      sourceUrls,
      recordType: record.recordType ?? "",
      countryOrRegion: record.countryOrRegion ?? "",
      institutions: record.institutions ?? [],
      coordinator: record.coordinator ?? "",
      relevanceScore: record.relevanceScore ?? 0,
      actionabilityScore: record.actionabilityScore ?? 0,
      sourceUrlClassifications,
      fetchAllowedSourceUrls,
      blockedSourceUrls,
      queueReason: queueReasonFor(record, fetchAllowedSourceUrls),
      queuedAt: nowIso,
    };
  });

  const output = {
    generatedAt: nowIso,
    command: "queue:image-enrichment",
    classifierVersion: CLASSIFIER_VERSION,
    methodVersion: QUEUE_METHOD_VERSION,
    isTestOutput: false,
    limit,
    totalCandidatesConsidered: allCandidates.length,
    skippedCooldown,
    queuedCount: queue.length,
    queue,
  };

  await fs.mkdir(processedDir, { recursive: true });
  await fs.writeFile(
    path.join(processedDir, "image-enrichment-queue.json"),
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
  const result = await queueImageEnrichment({ limit });

  console.log("\n" + "=".repeat(60));
  console.log("Image Enrichment Queue Summary");
  console.log("=".repeat(60));
  console.log(`Limit:                       ${result.limit}`);
  console.log(`Total eligible candidates:   ${result.totalCandidatesConsidered}`);
  console.log(`Skipped (cooldown):          ${result.skippedCooldown}`);
  console.log(`Queued:                      ${result.queuedCount}`);
  console.log("Wrote data/processed/image-enrichment-queue.json");
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during queue:image-enrichment:", error);
    process.exitCode = 1;
  });
}
