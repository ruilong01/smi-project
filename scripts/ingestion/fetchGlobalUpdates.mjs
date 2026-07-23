import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPENALEX_EMAIL, OPENALEX_TOPIC_QUERIES, RAW_COLLECTION_FROM_DATE } from "./config.mjs";
import { fetchJson, delayMs } from "./http.mjs";

// Incremental counterpart to fetch:openalex - instead of re-fetching every
// work back to RAW_COLLECTION_FROM_DATE every single run, this only asks
// OpenAlex for works CREATED OR UPDATED since the last successful refresh
// (OpenAlex's own `from_updated_date` filter, which - unlike
// from_publication_date - also catches metadata corrections on works we
// already have, not just brand-new publications). This is what makes the
// weekday 5am refresh cheap enough to run daily: a full topic sweep is
// npm run fetch:openalex's job, not this one's.
//
// Same global topic/country scope as the full fetch (OPENALEX_TOPIC_QUERIES
// already covers green shipping, alternative fuels, smart ports, maritime
// AI, autonomous vessels, cybersecurity, logistics, ship design, port
// decarbonisation, marine robotics and offshore/ocean tech; country
// coverage comes from wherever the matched works' institutions actually
// are, not a fixed country list - a country with zero extracted records
// simply has none yet, see getCoveragePendingCountries in the frontend).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const rawDir = path.join(rootDir, "data/raw/openalex");
const updateStatusPath = path.join(rootDir, "data/processed/update-status.json");

const PAGES_PER_QUERY = Number(process.env.OPENALEX_INCREMENTAL_PAGES_PER_QUERY ?? 2);
const PER_PAGE = 25;
const REQUEST_DELAY_MS = 1000;
// First-ever incremental run has no lastSuccessfulRefreshAt to anchor on -
// fall back to a 30-day lookback rather than the full RAW_COLLECTION_FROM_DATE
// history, since "incremental" should stay cheap even on day one.
const DEFAULT_LOOKBACK_DAYS = 30;

function runIdFromDate(date) {
  return `incremental-run-${date.toISOString().replace(/[:.]/g, "-")}`;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function resolveWindowStart() {
  const status = await readJsonIfExists(updateStatusPath);
  if (status?.lastSuccessfulRefreshAt) {
    return status.lastSuccessfulRefreshAt.slice(0, 10);
  }
  const fallback = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const iso = fallback.toISOString().slice(0, 10);
  return iso < RAW_COLLECTION_FROM_DATE ? RAW_COLLECTION_FROM_DATE : iso;
}

async function fetchQueryPage(query, page, windowStart) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(PER_PAGE));
  url.searchParams.set("page", String(page));
  url.searchParams.set("filter", `from_updated_date:${windowStart}`);
  url.searchParams.set("mailto", OPENALEX_EMAIL);

  return fetchJson(url.toString(), {
    fetchOptions: { email: OPENALEX_EMAIL, retries: 3, timeout: 30000, requestDelay: REQUEST_DELAY_MS },
  });
}

export async function fetchGlobalUpdates({ nowIso = new Date().toISOString() } = {}) {
  await fs.mkdir(rawDir, { recursive: true });

  const windowStart = await resolveWindowStart();
  const windowEnd = nowIso;

  const works = [];
  const seenWorkIds = new Set();
  const queryErrors = [];
  const queriesRun = [];

  for (const query of OPENALEX_TOPIC_QUERIES) {
    let queryWorkCount = 0;
    try {
      for (let page = 1; page <= PAGES_PER_QUERY; page++) {
        console.log(`[fetch:global-updates] "${query}" page ${page}/${PAGES_PER_QUERY} (since ${windowStart})`);
        const payload = await fetchQueryPage(query, page, windowStart);
        const results = payload?.results ?? [];

        for (const work of results) {
          if (!seenWorkIds.has(work.id)) {
            seenWorkIds.add(work.id);
            works.push({ query, work });
            queryWorkCount++;
          }
        }

        if (results.length < PER_PAGE) break;
        await delayMs(REQUEST_DELAY_MS);
      }
      queriesRun.push({ query, status: "success", workCount: queryWorkCount });
    } catch (error) {
      console.warn(`[fetch:global-updates] query failed "${query}": ${error.message}`);
      queryErrors.push({ query, error: error.message });
      queriesRun.push({ query, status: "failed", error: error.message });
    }
    await delayMs(REQUEST_DELAY_MS);
  }

  if (works.length === 0 && queryErrors.length === OPENALEX_TOPIC_QUERIES.length) {
    throw new Error(
      `All ${OPENALEX_TOPIC_QUERIES.length} OpenAlex queries failed during incremental fetch. First error: ${queryErrors[0]?.error}`
    );
  }

  const runId = runIdFromDate(new Date(nowIso));
  const rawFilePath = path.join(rawDir, `${runId}.json`);
  const rawPayload = {
    runId,
    source: "openalex",
    incremental: true,
    fetchedAt: nowIso,
    windowStart,
    windowEnd,
    email: OPENALEX_EMAIL,
    queriesRun,
    queryErrors,
    workCount: works.length,
    works,
  };

  await fs.writeFile(rawFilePath, `${JSON.stringify(rawPayload, null, 2)}\n`);
  console.log(
    `[fetch:global-updates] ${works.length} unique work(s) updated/created since ${windowStart} from ${queriesRun.filter((q) => q.status === "success").length}/${OPENALEX_TOPIC_QUERIES.length} queries -> ${path.relative(rootDir, rawFilePath)}`
  );

  return {
    runId,
    rawFilePath,
    relativeRawFilePath: path.relative(rootDir, rawFilePath),
    workCount: works.length,
    windowStart,
    windowEnd,
    queriesRun,
    queryErrors,
    fetchedAt: nowIso,
  };
}

async function main() {
  const result = await fetchGlobalUpdates();
  console.log("\n" + "=".repeat(60));
  console.log("Incremental Global Fetch Summary");
  console.log("=".repeat(60));
  console.log(`Window:          ${result.windowStart} -> ${result.windowEnd}`);
  console.log(`Works fetched:   ${result.workCount}`);
  console.log(`Queries OK:      ${result.queriesRun.filter((q) => q.status === "success").length}/${OPENALEX_TOPIC_QUERIES.length}`);
  console.log(`Raw file:        ${result.relativeRawFilePath}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during fetch:global-updates:", error);
    process.exitCode = 1;
  });
}
