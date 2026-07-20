import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, delayMs } from "./http.mjs";
import { normalizeOpenAlexRecord } from "./adapters/openalex.adapter.mjs";
import { verifyCrossrefDoi } from "./adapters/crossref.adapter.mjs";
import { buildDataset } from "./buildDataset.mjs";

// Slowly expands the dataset from data/seed/global_research_automation_queue.json,
// a few tasks at a time (10-25 per run, per the queue's own rules). Each
// task becomes a real OpenAlex search (raw range 2015-present, per
// rules.raw_range); DOIs found are verified against Crossref the same way
// runExtraction.mjs already does. No records are fabricated - a task that
// finds nothing is marked "completed_no_results", not padded with anything.
//
// DataCite is listed in the queue's recommended_sources but has no adapter
// in this codebase yet (only openalex/crossref/manual exist per the lean-MVP
// scope in runExtraction.mjs) - this run does not query it. Flagged here
// rather than silently skipped.
//
// Re-run this command to advance through the queue: npm run queue:process

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const seedDir = path.join(rootDir, "data/seed");
const generatedPath = path.join(rootDir, "src/data/generated/liveResearchData.json");
const queuePath = path.join(seedDir, "global_research_automation_queue.json");

const MIN_BATCH = 10;
const MAX_BATCH = 25;
const DEFAULT_BATCH = 15;

function resolveBatchSize() {
  const arg = process.argv.find((a) => a.startsWith("--batch="));
  const raw = arg ? Number(arg.split("=")[1]) : DEFAULT_BATCH;
  if (!Number.isFinite(raw)) return DEFAULT_BATCH;
  return Math.min(MAX_BATCH, Math.max(MIN_BATCH, Math.round(raw)));
}

async function readPreviousDataset() {
  try {
    const raw = await fs.readFile(generatedPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchTaskRecords(task, nowIso) {
  const email = "research-demo@example.invalid";
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", task.search_terms);
  url.searchParams.set("per-page", "25");
  // Raw range per queue rules: 2015-present. The 2020-present "default
  // display" and 2024-present "latest highlight" windows are display-layer
  // concerns (scoring/recency), not a fetch-time filter - narrowing here
  // would silently discard real 2015-2019 records the rules say to keep.
  url.searchParams.set("filter", "from_publication_date:2015-01-01");
  url.searchParams.set("mailto", email);

  const payload = await fetchJson(url.toString(), {
    fetchOptions: { email, retries: 3, timeout: 30000, requestDelay: 1000 },
  });

  const works = payload?.results ?? [];
  return works.map((work) => normalizeOpenAlexRecord({ record: work }, nowIso)).filter(Boolean);
}

async function verifyDois(records, nowIso) {
  const sources = [];
  const dois = records.map((record) => record.project.doi).filter(Boolean);

  for (const doi of dois) {
    const verification = await verifyCrossrefDoi(doi, nowIso);
    if (verification) {
      sources.push(verification.source);
    }
    await delayMs(500);
  }

  return sources;
}

async function main() {
  const batchSize = resolveBatchSize();
  const nowIso = new Date().toISOString();

  const queueRaw = await fs.readFile(queuePath, "utf8");
  const queue = JSON.parse(queueRaw);

  const queuedTasks = queue.tasks.filter((task) => task.status === "queued");
  if (queuedTasks.length === 0) {
    console.log("No queued automation tasks remain - nothing to process.");
    return;
  }

  const batch = queuedTasks.slice(0, batchSize);
  console.log(
    `\nProcessing ${batch.length} of ${queuedTasks.length} remaining queued tasks ` +
      `(batch size ${batchSize}, allowed range ${MIN_BATCH}-${MAX_BATCH}).\n`
  );

  const newOutputs = [];
  let totalFound = 0;
  const errors = [];

  for (const task of batch) {
    process.stdout.write(`  ${task.task_id} (${task.country} / ${task.topic})... `);
    try {
      const records = await fetchTaskRecords(task, nowIso);
      task.status = records.length > 0 ? "completed" : "completed_no_results";
      task.recordsFound = records.length;
      task.processedAt = nowIso;
      newOutputs.push(...records);
      totalFound += records.length;
      console.log(`${records.length} record(s)`);
    } catch (error) {
      // Leave status as "queued" (do not consume the task) - a fetch
      // failure (rate limiting, timeout, network blip) is transient, not a
      // verdict that the task has no useful records. It will be retried on
      // the next `npm run queue:process` call. lastError/lastAttemptedAt
      // are recorded for visibility only.
      task.lastError = error.message;
      task.lastAttemptedAt = nowIso;
      errors.push(`${task.task_id}: ${error.message}`);
      console.log(`failed (will retry next run): ${error.message}`);
    }
    await delayMs(1000);
  }

  await fs.writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`);

  const crossrefSources = await verifyDois(newOutputs, nowIso);

  const previous = await readPreviousDataset();
  const previousAsAdapterOutput = previous
    ? {
        projects: previous.projects ?? [],
        institutions: previous.institutions ?? [],
        sources: previous.sources ?? [],
        relationships: previous.relationships ?? [],
      }
    : null;

  const queueRun = {
    id: `run-automation-queue-${Date.now()}`,
    sourceId: "automation-queue",
    sourceName: "Global Research Automation Queue",
    extractionMethod: "OpenAlex API + Crossref DOI verification (queue-driven)",
    startedAt: nowIso,
    completedAt: new Date().toISOString(),
    status: errors.length === batch.length ? "failed" : "success",
    recordsFetched: totalFound,
    recordsCreated: newOutputs.length,
    recordsUpdated: 0,
    recordsRejected: 0,
    parseErrors: errors,
    rateLimitStatus: "not-rate-limited",
  };
  const queueStatus = {
    sourceId: "automation-queue",
    sourceName: "Global Research Automation Queue",
    extractionType: "OpenAlex API + Crossref DOI verification (queue-driven)",
    lastAttemptedSync: nowIso,
    lastSuccessfulSync: new Date().toISOString(),
    recordsFetched: totalFound,
    recordsCreated: newOutputs.length,
    recordsUpdated: 0,
    recordsRejected: 0,
    parseErrors: errors,
    rateLimitStatus: "not-rate-limited",
    nextScheduledRun: "",
  };

  const dataset = buildDataset({
    adapterOutputs: [
      ...(previousAsAdapterOutput ? [previousAsAdapterOutput] : []),
      ...newOutputs,
      { sources: crossrefSources },
    ],
    extractionRuns: [queueRun, ...(previous?.extractionRuns ?? [])].slice(0, 40),
    nowIso,
    sourceStatus: [
      ...(previous?.meta?.sourceStatus ?? []).filter((s) => s.sourceId !== "automation-queue"),
      queueStatus,
    ],
  });

  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  await fs.writeFile(generatedPath, `${JSON.stringify(dataset, null, 2)}\n`);

  const remaining = queue.tasks.filter((t) => t.status === "queued").length;

  console.log("\n" + "=".repeat(60));
  console.log("🌐 Automation Queue Batch Summary");
  console.log("=".repeat(60));
  console.log(`Tasks processed this batch:  ${batch.length}`);
  console.log(`New records added:           ${newOutputs.length}`);
  console.log(`Crossref DOIs verified:      ${crossrefSources.length}`);
  console.log(`Tasks remaining in queue:    ${remaining}`);
  console.log(
    `Generated dataset now has:   ${dataset.publicProjects.length} public projects, ${dataset.countries.length} countries`
  );
  console.log(`Queue file updated:          data/seed/global_research_automation_queue.json`);
  console.log("=".repeat(60) + "\n");
  console.log(`Run again to process the next batch: npm run queue:process`);
}

main().catch((error) => {
  console.error("Fatal error during automation queue processing:", error);
  process.exitCode = 1;
});
