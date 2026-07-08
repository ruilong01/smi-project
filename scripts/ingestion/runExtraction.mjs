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
    const records = await fn();
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

      return normalized.slice(0, 10);
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
        .slice(0, 5);
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
        .slice(0, 8);
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

  const dataset = buildDataset({
    adapterOutputs,
    extractionRuns: [openAlex.run, crossref.run, ror.run, mpa.run],
    nowIso,
    sourceStatus: [openAlex.status, crossref.status, ror.status, mpa.status],
  });

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);

  console.log(
    `Generated ${dataset.publicProjects.length} public projects, ${dataset.countries.length} countries, ${dataset.relationships.length} relationships`
  );
  console.log(`Wrote ${outputPath}`);
}

async function main() {
  await runExtractionOnce();

  if (process.argv.includes("--watch")) {
    console.log(
      `Watching for updates every ${TEST_REFRESH_INTERVAL_MS / 1000} seconds`
    );
    setInterval(() => {
      runExtractionOnce().catch((error) => {
        console.error(error);
      });
    }, TEST_REFRESH_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
