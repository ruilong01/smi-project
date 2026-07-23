import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OPENALEX_EMAIL,
  OPENALEX_TOPIC_QUERIES,
  RAW_COLLECTION_FROM_DATE,
} from "./config.mjs";
import { fetchJson, delayMs } from "./http.mjs";

// Phase 1 real-data source (per the AWS data-fetch plan): queries OpenAlex
// Works directly from wherever this runs (local machine or the AWS server -
// there is no browser/AI fetching involved). Saves EVERY raw API response
// verbatim to data/raw/openalex/<runId>.json before anything is processed,
// so raw evidence always exists independent of how processing logic
// evolves later. Never called from the React frontend - see
// docs/AWS_DATA_REFRESH.md for the architecture reasoning.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const rawDir = path.join(rootDir, "data/raw/openalex");

const PAGES_PER_QUERY = Number(process.env.OPENALEX_PAGES_PER_QUERY ?? 2);
const PER_PAGE = 25;
const REQUEST_DELAY_MS = 1000;

function runIdFromDate(date) {
  return `run-${date.toISOString().replace(/[:.]/g, "-")}`;
}

async function fetchQueryPage(query, page, nowIso) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(PER_PAGE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("filter", `from_publication_date:${RAW_COLLECTION_FROM_DATE}`);
  url.searchParams.set("mailto", OPENALEX_EMAIL);

  return fetchJson(url.toString(), {
    fetchOptions: {
      email: OPENALEX_EMAIL,
      retries: 3,
      timeout: 30000,
      requestDelay: REQUEST_DELAY_MS,
    },
  });
}

// Exported for reuse by refreshData.mjs - returns the run's summary and
// writes the raw file as a side effect. Never throws for a single query
// failure (logged, skipped) - only throws if every query failed, so a
// scheduled run can distinguish "quiet day" from "source is broken".
export async function fetchOpenAlexRaw({ nowIso = new Date().toISOString() } = {}) {
  await fs.mkdir(rawDir, { recursive: true });

  const works = [];
  const seenWorkIds = new Set();
  const queryErrors = [];
  const queriesRun = [];

  for (const query of OPENALEX_TOPIC_QUERIES) {
    let queryWorkCount = 0;
    try {
      for (let page = 1; page <= PAGES_PER_QUERY; page++) {
        console.log(`[fetch:openalex] "${query}" page ${page}/${PAGES_PER_QUERY}`);
        const payload = await fetchQueryPage(query, page, nowIso);
        const results = payload?.results ?? [];

        for (const work of results) {
          if (!seenWorkIds.has(work.id)) {
            seenWorkIds.add(work.id);
            works.push({ query, work });
            queryWorkCount++;
          }
        }

        if (results.length < PER_PAGE) {
          break; // fewer than a full page = no more results for this query
        }

        await delayMs(REQUEST_DELAY_MS);
      }
      queriesRun.push({ query, status: "success", workCount: queryWorkCount });
    } catch (error) {
      console.warn(`[fetch:openalex] query failed "${query}": ${error.message}`);
      queryErrors.push({ query, error: error.message });
      queriesRun.push({ query, status: "failed", error: error.message });
    }
    await delayMs(REQUEST_DELAY_MS);
  }

  if (works.length === 0 && queryErrors.length === OPENALEX_TOPIC_QUERIES.length) {
    throw new Error(
      `All ${OPENALEX_TOPIC_QUERIES.length} OpenAlex queries failed. First error: ${queryErrors[0]?.error}`
    );
  }

  const runId = runIdFromDate(new Date(nowIso));
  const rawFilePath = path.join(rawDir, `${runId}.json`);
  const rawPayload = {
    runId,
    source: "openalex",
    fetchedAt: nowIso,
    rawCollectionFromDate: RAW_COLLECTION_FROM_DATE,
    email: OPENALEX_EMAIL,
    queriesRun,
    queryErrors,
    workCount: works.length,
    works,
  };

  await fs.writeFile(rawFilePath, `${JSON.stringify(rawPayload, null, 2)}\n`);
  console.log(
    `[fetch:openalex] wrote ${works.length} unique works from ${queriesRun.filter((q) => q.status === "success").length}/${OPENALEX_TOPIC_QUERIES.length} queries -> ${path.relative(rootDir, rawFilePath)}`
  );

  return {
    runId,
    rawFilePath,
    relativeRawFilePath: path.relative(rootDir, rawFilePath),
    workCount: works.length,
    queriesRun,
    queryErrors,
    fetchedAt: nowIso,
  };
}

async function main() {
  const result = await fetchOpenAlexRaw();
  console.log("\n" + "=".repeat(60));
  console.log("OpenAlex Fetch Summary");
  console.log("=".repeat(60));
  console.log(`Run ID:          ${result.runId}`);
  console.log(`Works fetched:   ${result.workCount}`);
  console.log(`Queries OK:      ${result.queriesRun.filter((q) => q.status === "success").length}/${OPENALEX_TOPIC_QUERIES.length}`);
  console.log(`Raw file:        ${result.relativeRawFilePath}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during OpenAlex fetch:", error);
    process.exitCode = 1;
  });
}
