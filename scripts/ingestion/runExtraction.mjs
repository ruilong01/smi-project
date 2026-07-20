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
import { fetchManualRecords } from "./adapters/manual.adapter.mjs";
import { buildDataset } from "./buildDataset.mjs";
import { resolveSourcePagesForProject } from "./enrichment/resolveSourcePages.mjs";
import { extractWebpage } from "./enrichment/extractWebpage.mjs";
import { chunkPage } from "./enrichment/chunkText.mjs";

// Safety cap on NEW website visits per run — politeness towards source
// sites and bounded run time. Projects already carrying sourcePages from a
// previous run are skipped entirely (see webEnrichProjects below), so this
// only limits how many *newly discovered* projects get a site visit per run.
const MAX_NEW_SOURCE_PAGE_FETCHES_PER_RUN = 15;

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

/**
 * Steps 2-4 of the AI Evidence Selection pipeline: source resolution,
 * website extraction, chunking (see CLAUDE.md goal tracker item 9). Plain
 * code only — no AI here. For each project that OpenAlex discovered:
 *   - if a previous run already extracted its source page(s), those are
 *     carried forward unchanged (no repeat fetch of the same site, and any
 *     later-added aiAnalysis/selectedEvidence survives this project being
 *     "rediscovered" by a fresh OpenAlex query this run);
 *   - otherwise, up to a capped number of NEW site visits happen this run.
 * Mutates each project's `sourcePages`/`dataQuality` in place.
 */
async function webEnrichProjects(projects, previousProjectsById) {
  let newlyFetched = 0;
  let skippedCap = 0;
  let carriedForward = 0;
  let failed = 0;

  for (const { project } of projects) {
    const previousProject = previousProjectsById.get(project.id);

    if (previousProject?.sourcePages?.length) {
      project.sourcePages = previousProject.sourcePages;
      project.selectedEvidence = previousProject.selectedEvidence ?? [];
      project.aiAnalysis = previousProject.aiAnalysis ?? null;
      project.dataQuality = previousProject.dataQuality ?? project.dataQuality;
      carriedForward += 1;
      continue;
    }

    const candidates = resolveSourcePagesForProject(project);
    const candidate = candidates[0];
    if (!candidate) {
      continue;
    }

    if (newlyFetched >= MAX_NEW_SOURCE_PAGE_FETCHES_PER_RUN) {
      skippedCap += 1;
      continue;
    }

    try {
      newlyFetched += 1;
      console.log(`  🌐 Visiting source page: ${candidate.url}`);
      const page = await extractWebpage(candidate.url);
      const chunks = chunkPage(page);

      project.sourcePages = [
        {
          sourceId: `sourcepage-${project.id}`,
          sourceType: candidate.sourceType,
          sourceName: page.pageTitle ?? candidate.url,
          sourceUrl: candidate.url,
          pageTitle: page.pageTitle ?? "",
          publishedDate: page.publishedDate ?? "",
          fetchedAt: new Date().toISOString(),
          rawTextStored: false,
          cleanedTextSummary: chunks[0]?.text ?? "",
          chunks,
          images: page.images ?? [],
        },
      ];
      project.dataQuality = {
        ...project.dataQuality,
        hasOriginalSource: true,
        hasOfficialSource: candidate.sourceType === "government",
        imageCandidateCount: page.images?.length ?? 0,
        needsManualReview: chunks.length === 0,
      };
    } catch (error) {
      failed += 1;
      console.warn(`  ✗ Failed to extract ${candidate.url}: ${error.message}`);
      // Leave sourcePages empty; dataQuality.needsManualReview already
      // defaults to true. One bad page must not stop the run.
    }
  }

  console.log(
    `  📄 Web enrichment: ${newlyFetched} fetched, ${carriedForward} carried forward, ` +
      `${failed} failed, ${skippedCap} skipped (per-run cap)`
  );
}

async function runExtractionOnce() {
  console.log("\n" + "=".repeat(60));
  console.log("🌍 Starting Maritime R&D Data Extraction");
  console.log("=".repeat(60));

  const nowIso = new Date().toISOString();
  const previous = await readPreviousDataset();
  const previousProjectsById = new Map(
    (previous?.projects ?? []).map((project) => [project.id, project])
  );

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
      // project id here (first occurrence wins) before anything downstream
      // (Crossref/ROR lookups, web enrichment) processes it more than once
      // as separate objects sharing one id.
      const seenIds = new Set();
      const deduped = normalized.filter((record) => {
        if (seenIds.has(record.project.id)) return false;
        seenIds.add(record.project.id);
        return true;
      });

      // Safety cap, not a target — real yield is bounded by how many
      // results pass isStrongMaritimeMatch + require a resolvable country.
      return deduped.slice(0, 200);
    }
  );

  await webEnrichProjects(openAlex.records, previousProjectsById);

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
    ...ror.records,
    ...mpa.records,
    ...manual.records,
  ];

  const dataset = buildDataset({
    adapterOutputs,
    extractionRuns: [
      openAlex.run,
      crossref.run,
      ror.run,
      mpa.run,
      manual.run,
      ...(previous?.extractionRuns ?? []),
    ].slice(0, 40),
    nowIso,
    sourceStatus: [
      openAlex.status,
      crossref.status,
      ror.status,
      mpa.status,
      manual.status,
    ],
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
