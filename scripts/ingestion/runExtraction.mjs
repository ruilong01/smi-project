import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_REFRESH_INTERVAL_MS } from "./config.mjs";
import { verifyCrossrefDoi } from "./adapters/crossref.adapter.mjs";
import {
  fetchOpenAlexRecords,
  normalizeOpenAlexRecord,
} from "./adapters/openalex.adapter.mjs";
import { fetchManualRecords } from "./adapters/manual.adapter.mjs";
import { buildDataset } from "./buildDataset.mjs";

// MVP scope: OpenAlex (discovery) + Crossref (DOI verification) + Manual
// (human-curated) only. ROR institution enrichment, the MPA official-page
// adapter, and the website-crawling/evidence/image enrichment pipeline
// (scripts/ingestion/enrichment/, enrichSample.mjs) are parked, not
// deleted — see CLAUDE.md for the lean-MVP rationale. Re-enable by
// restoring the ror/mpa imports+runSource blocks below and the
// webEnrichProjects step from git history when that work resumes.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(
  __dirname,
  "../../src/data/generated/liveResearchData.json"
);

async function runSource(sourceId, sourceName, extractionMethod, fn) {
  const startedAt = new Date().toISOString();
  try {
    console.log(`\n🔄 Starting extraction: ${sourceName} (${extractionMethod})`);
    const records = await fn();
    console.log(`✅ ${sourceName}: Successfully extracted ${records.length} records`);

    return {
      records,
      run: {
        id: `run-${sourceId}-${Date.now()}`,
        sourceId,
        sourceName,
        extractionMethod,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "success",
        recordsFetched: records.length,
        recordsCreated: records.length,
        recordsUpdated: 0,
        recordsRejected: 0,
        parseErrors: [],
        rateLimitStatus: "not-rate-limited",
      },
      status: {
        sourceId,
        sourceName,
        extractionType: extractionMethod,
        lastAttemptedSync: startedAt,
        lastSuccessfulSync: new Date().toISOString(),
        recordsFetched: records.length,
        recordsCreated: records.length,
        recordsUpdated: 0,
        recordsRejected: 0,
        parseErrors: [],
        rateLimitStatus: "not-rate-limited",
        nextScheduledRun: new Date(Date.now() + TEST_REFRESH_INTERVAL_MS).toISOString(),
      },
    };
  } catch (error) {
    console.error(`❌ ${sourceName}: Failed - ${error.message}`);
    return {
      records: [],
      run: {
        id: `run-${sourceId}-${Date.now()}`,
        sourceId,
        sourceName,
        extractionMethod,
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        recordsFetched: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsRejected: 0,
        parseErrors: [error.message],
        rateLimitStatus: "unknown",
      },
      status: {
        sourceId,
        sourceName,
        extractionType: extractionMethod,
        lastAttemptedSync: startedAt,
        lastSuccessfulSync: "",
        recordsFetched: 0,
        recordsCreated: 0,
        recordsUpdated: 0,
        recordsRejected: 0,
        parseErrors: [error.message],
        rateLimitStatus: "unknown",
        nextScheduledRun: new Date(Date.now() + TEST_REFRESH_INTERVAL_MS).toISOString(),
      },
    };
  }
}

async function runExtractionOnce() {
  console.log("\n" + "=".repeat(60));
  console.log("🌍 Starting Maritime R&D Data Extraction");
  console.log("=".repeat(60));

  const nowIso = new Date().toISOString();
  const previous = await readPreviousDataset();

  const openAlex = await runSource(
    "openalex",
    "OpenAlex",
    "structured API",
    async () => {
      const rawRecords = await fetchOpenAlexRecords();
      const normalized = rawRecords
        .map((record) => normalizeOpenAlexRecord(record, nowIso))
        .filter(Boolean);

      // The 24 search queries deliberately overlap thematically, so the
      // same OpenAlex work often matches more than one query — dedupe by
      // project id here (first occurrence wins) before Crossref processes
      // it more than once as separate objects sharing one id.
      const seenIds = new Set();
      const deduped = normalized.filter((record) => {
        if (seenIds.has(record.project.id)) return false;
        seenIds.add(record.project.id);
        return true;
      });

      // normalizeOpenAlexRecord always starts a project with images: [] and
      // no sourcePages — fetch:publication-images (scripts/ingestion/
      // fetchPublicationImages.mjs) fills those in afterwards, as a
      // separate deliberate step. Since buildDataset dedupes projects by id
      // with "later entry wins" and this fresh batch is appended after the
      // carried-forward previous dataset, re-running sync:data would
      // otherwise silently wipe out every image fetch:publication-images
      // found. Carry the previous project's images/sourcePages forward
      // whenever this run's own re-fetch came back with none.
      const previousProjectsById = new Map((previous?.projects ?? []).map((p) => [p.id, p]));
      deduped.forEach((record) => {
        const previousProject = previousProjectsById.get(record.project.id);
        if (!previousProject) return;
        if (!record.project.images?.length && previousProject.images?.length) {
          record.project.images = previousProject.images;
        }
        if (!record.project.sourcePages?.length && previousProject.sourcePages?.length) {
          record.project.sourcePages = previousProject.sourcePages;
        }
      });

      // Safety cap, not a target — real yield is bounded by how many
      // results pass isStrongMaritimeMatch + require a resolvable country.
      return deduped.slice(0, 200);
    }
  );

  const crossref = await runSource(
    "crossref",
    "Crossref",
    "structured API",
    async () => {
      const doiRecords = openAlex.records
        .map((record) => record.project.doi)
        .filter(Boolean)
        .slice(0, 60);

      if (doiRecords.length === 0) {
        console.log("  (No DOIs from OpenAlex to verify with Crossref)");
        return [];
      }

      const outputs = [];

      for (const doi of doiRecords) {
        const verification = await verifyCrossrefDoi(doi, nowIso);
        if (verification) {
          outputs.push({
            sources: [verification.source],
          });
        }
      }

      return outputs;
    }
  );

  const manual = await runSource(
    "manual",
    "Manually Curated Records",
    "human-verified manual entry",
    async () => fetchManualRecords(nowIso)
  );

  // Accumulate with history instead of rebuilding from scratch each run:
  // feed the previous run's already-built projects/institutions/sources/
  // relationships back into buildDataset alongside this run's fresh
  // records. buildDataset dedupes by id (fresher wins) and recomputes all
  // derived fields (scores, country aggregates) from the full set, so this
  // is safe to do unconditionally, including when a run finds 0 new records.
  //
  // Manual entries are the one exception: manualSources.mjs is a hand-
  // edited, user-authoritative list, unlike OpenAlex results (dropping out
  // of a search's top results doesn't mean a paper stopped existing). If a
  // project id was removed from manualSources.mjs, it must disappear from
  // the dataset too, not linger forever via accumulation.
  const currentManualProjectIds = new Set(
    manual.records.map((record) => record.project.id)
  );
  const carriedForwardProjects = (previous?.projects ?? []).filter(
    (project) =>
      !project.id.startsWith("project-manual-") ||
      currentManualProjectIds.has(project.id)
  );

  const previousAsAdapterOutput = previous
    ? {
        projects: carriedForwardProjects,
        institutions: previous.institutions ?? [],
        sources: previous.sources ?? [],
        relationships: previous.relationships ?? [],
      }
    : null;

  const adapterOutputs = [
    ...(previousAsAdapterOutput ? [previousAsAdapterOutput] : []),
    ...openAlex.records,
    ...crossref.records,
    ...manual.records,
  ];

  const dataset = buildDataset({
    adapterOutputs,
    extractionRuns: [
      openAlex.run,
      crossref.run,
      manual.run,
      ...(previous?.extractionRuns ?? []),
    ].slice(0, 40),
    nowIso,
    sourceStatus: [openAlex.status, crossref.status, manual.status],
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);

  console.log("\n" + "=".repeat(60));
  console.log("📊 Extraction Summary");
  console.log("=".repeat(60));
  console.log(`📍 Generated ${dataset.publicProjects.length} public projects`);
  console.log(`🌐 From ${dataset.countries.length} countries`);
  console.log(`🔗 Created ${dataset.relationships.length} relationships`);
  console.log(`💾 Wrote ${outputPath}`);
  console.log("=".repeat(60) + "\n");
}

async function readPreviousDataset() {
  try {
    const raw = await fs.readFile(outputPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  await runExtractionOnce();

  if (process.argv.includes("--watch")) {
    console.log(
      `⏰ Watching for updates every ${TEST_REFRESH_INTERVAL_MS / 1000} seconds\n`
    );
    setInterval(() => {
      runExtractionOnce().catch((error) => {
        console.error("Fatal error during scheduled extraction:", error);
      });
    }, TEST_REFRESH_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
