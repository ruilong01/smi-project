import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_REFRESH_INTERVAL_MS } from "./config.mjs";
import { verifyCrossrefDoi } from "./adapters/crossref.adapter.mjs";
import {
  fetchOpenAlexRecords,
  normalizeOpenAlexRecord,
} from "./adapters/openalex.adapter.mjs";
import { enrichInstitutionFromRor } from "./adapters/ror.adapter.mjs";
import { fetchMpaOfficialRecords } from "./adapters/mpa.adapter.mjs";
import { buildDataset } from "./buildDataset.mjs";

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

  const openAlex = await runSource(
    "openalex",
    "OpenAlex",
    "structured API",
    async () => {
      const rawRecords = await fetchOpenAlexRecords();
      const normalized = rawRecords
        .map((record) => normalizeOpenAlexRecord(record, nowIso))
        .filter(Boolean);

      // Safety cap, not a target — real yield is bounded by how many
      // results pass isStrongMaritimeMatch + require a resolvable country.
      return normalized.slice(0, 200);
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

  const ror = await runSource(
    "ror",
    "Research Organization Registry",
    "structured API",
    async () => {
      const institutions = openAlex.records
        .flatMap((record) => record.institutions)
        .filter((institution) => institution.rorId)
        .slice(0, 60);

      if (institutions.length === 0) {
        console.log("  (No institutions from OpenAlex to enrich with ROR)");
        return [];
      }

      const enriched = [];

      for (const institution of institutions) {
        enriched.push({
          institutions: [await enrichInstitutionFromRor(institution)],
        });
      }

      return enriched;
    }
  );

  const mpa = await runSource(
    "mpa",
    "Maritime and Port Authority of Singapore",
    "controlled official webpage extractor",
    async () => fetchMpaOfficialRecords(nowIso)
  );

  const adapterOutputs = [
    ...openAlex.records,
    ...crossref.records,
    ...ror.records,
    ...mpa.records,
  ];

  let dataset = buildDataset({
    adapterOutputs,
    extractionRuns: [openAlex.run, crossref.run, ror.run, mpa.run],
    nowIso,
    sourceStatus: [openAlex.status, crossref.status, ror.status, mpa.status],
  });

  // Guard: a run that produced zero projects (e.g. every source blocked)
  // must not wipe previously extracted data. Keep the last good dataset
  // and only refresh the run logs and source status so failures stay
  // visible on /sources/status.
  if (dataset.publicProjects.length === 0) {
    const previous = await readPreviousDataset();

    if (previous && previous.publicProjects?.length > 0) {
      console.warn(
        "⚠️  Extraction returned 0 projects. Preserving previous dataset " +
          `(${previous.publicProjects.length} projects from ${previous.meta?.lastSuccessfulSync ?? "unknown"}).`
      );
      dataset = {
        ...previous,
        meta: {
          ...previous.meta,
          generatedAt: dataset.meta.generatedAt,
          sourceStatus: dataset.meta.sourceStatus,
          statusMessage:
            "Showing data from the last successful synchronisation. The most recent extraction attempt returned no records.",
        },
        extractionRuns: [
          ...dataset.extractionRuns,
          ...(previous.extractionRuns ?? []),
        ].slice(0, 20),
      };
    }
  }

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
