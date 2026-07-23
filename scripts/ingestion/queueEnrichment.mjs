import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Turns data/processed/pending-image-enrichment.json (real, source-linked
// records with no image yet) into a prioritized queue so enrich:images
// spends its limited, rate-limited attempts on the records most worth
// showing first, rather than in whatever order they happen to appear in
// research-records.json.
//
// HIGH priority: actionabilityScore or relevanceScore >= HIGH_PRIORITY_
// THRESHOLD, or a record that has never had an image attempt at all.
// NORMAL priority: everything else real and pending.
// Records that already failed an image attempt recently are pushed to the
// back (not re-tried every single incremental run) via lastImageAttemptAt.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const processedDir = path.join(rootDir, "data/processed");

const HIGH_PRIORITY_THRESHOLD = 70;
// Don't retry a record's image fetch more than once every N days - most
// failures are a page that will still be blocked/unavailable tomorrow.
const RETRY_COOLDOWN_DAYS = 14;

function priorityFor(record) {
  if ((record.actionabilityScore ?? 0) >= HIGH_PRIORITY_THRESHOLD) return "high";
  if ((record.relevanceScore ?? 0) >= HIGH_PRIORITY_THRESHOLD) return "high";
  return "normal";
}

function isInCooldown(record, nowIso) {
  if (!record.lastImageAttemptAt) return false;
  const elapsedMs = new Date(nowIso) - new Date(record.lastImageAttemptAt);
  return elapsedMs < RETRY_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
}

export async function queueEnrichment({ processedDir: dir = processedDir, nowIso = new Date().toISOString() } = {}) {
  const pendingData = JSON.parse(
    await fs.readFile(path.join(dir, "pending-image-enrichment.json"), "utf8")
  );
  const records = pendingData.records ?? [];

  const queue = records
    .filter((record) => !isInCooldown(record, nowIso))
    .map((record) => ({
      recordId: record.recordId,
      title: record.title,
      sourceUrl: record.sourceUrl || record.sourceUrls?.[0] || null,
      priority: priorityFor(record),
      actionabilityScore: record.actionabilityScore ?? null,
      relevanceScore: record.relevanceScore ?? null,
    }))
    .filter((item) => item.sourceUrl)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority === "high" ? -1 : 1;
      return (b.actionabilityScore ?? 0) - (a.actionabilityScore ?? 0);
    });

  const skippedNoSourceUrl = records.length - queue.length - records.filter((r) => isInCooldown(r, nowIso)).length;
  const skippedCooldown = records.filter((r) => isInCooldown(r, nowIso)).length;

  const output = {
    generatedAt: nowIso,
    totalPending: records.length,
    queuedCount: queue.length,
    skippedCooldown,
    skippedNoSourceUrl,
    highPriorityCount: queue.filter((q) => q.priority === "high").length,
    queue,
  };

  await fs.writeFile(
    path.join(dir, "enrichment-queue.json"),
    `${JSON.stringify(output, null, 2)}\n`
  );

  return output;
}

async function main() {
  const result = await queueEnrichment();
  console.log("\n" + "=".repeat(60));
  console.log("Enrichment Queue Summary");
  console.log("=".repeat(60));
  console.log(`Total pending records:     ${result.totalPending}`);
  console.log(`Queued (has source URL):   ${result.queuedCount}`);
  console.log(`  high priority:           ${result.highPriorityCount}`);
  console.log(`Skipped (cooldown):        ${result.skippedCooldown}`);
  console.log(`Skipped (no source URL):  ${result.skippedNoSourceUrl}`);
  console.log("Wrote data/processed/enrichment-queue.json");
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during queue:enrichment:", error);
    process.exitCode = 1;
  });
}
