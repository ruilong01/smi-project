import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson, delayMs } from "./http.mjs";
import countryRegistryData from "../../src/data/generated/countryRegistry.json" with { type: "json" };
import { classifySourceCredibility } from "../processing/sourceCredibilityClassifier.mjs";
import { getSourceById } from "./globalSourceRegistry.mjs";

// Step 5 of the global data/image expansion plan (see
// docs/GLOBAL_DATA_AND_IMAGE_EXPANSION_PLAN.md): an incremental, source-
// proven research discovery pass across a broad maritime/marine/port/ocean
// technology term list, real OpenAlex API queries only (no AI-generated
// content, no fake records). Writes to a STAGING file only
// (data/processed/test/research-discovery-candidates.json) - it NEVER
// touches data/processed/research-records.json or display-records.json.
// Promoting a candidate into the real pipeline is a separate, explicit,
// human-reviewed step (the existing process:records/compare:records flow),
// out of scope here by design.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const outputPath = path.join(rootDir, "data/processed/test/research-discovery-candidates.json");
const productionRecordsPath = path.join(rootDir, "data/processed/research-records.json");

const CONTACT_EMAIL = process.env.OPENALEX_EMAIL || "research-demo@example.invalid";

// The broader maritime/marine/port/ocean topic list this step asks for -
// additive to (not replacing) scripts/ingestion/config.mjs's existing
// OPENALEX_TOPIC_QUERIES, which stays exactly as-is (Do not change data
// extraction).
export const DISCOVERY_TOPIC_QUERIES = [
  "maritime autonomy",
  "autonomous vessels",
  "smart port",
  "green shipping",
  "decarbonisation shipping",
  "maritime cybersecurity",
  "maritime artificial intelligence",
  "marine robotics",
  "ocean monitoring",
  "port digital twin",
  "vessel traffic optimization",
  "marine renewable energy",
  "offshore wind maritime logistics",
  "ballast water treatment",
  "ship emissions",
  "maritime safety",
  "underwater robotics",
  "ocean observation",
  "coastal resilience",
  "marine data platform",
  "seafarer safety technology",
];

const DEFAULT_LIMIT = 20;
const DEFAULT_PER_TOPIC_PAGE_SIZE = 5;
const DEFAULT_TOPICS_PER_RUN = 6; // keep a default run small/cheap - pass --limit higher to widen deliberately

function nowIso() {
  return new Date().toISOString();
}

export function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeUrl(url) {
  return (url || "").trim().toLowerCase().replace(/\/$/, "");
}

// OpenAlex returns abstracts as an inverted index (word -> [positions]),
// not plain text, to respect publisher copyright on full abstracts (see
// https://docs.openalex.org/api-entities/works/work-object#abstract_inverted_index) -
// this reconstructs the plain sentence from it, same technique the rest
// of this pipeline already relies on for abstracts (no new dependency).
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";
  const positioned = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    positions.forEach((pos) => {
      positioned[pos] = word;
    });
  }
  return positioned.filter(Boolean).join(" ");
}

function bestSourceUrl(work) {
  return work.doi || work.primary_location?.landing_page_url || work.open_access?.oa_url || work.id;
}

// When a country filter was used, OpenAlex only guarantees at least ONE
// authorship matches it - the first author is very often a co-author from
// a DIFFERENT country. Picking authorships[0] unconditionally would then
// attribute the record to the wrong country (confirmed against real API
// responses: a Netherlands-filtered "maritime autonomy" search returned
// works whose first author was Chinese/American/Finnish, with Delft
// University of Technology only appearing as a co-author). When a country
// filter is active, find the first authorship whose institution actually
// matches it; fall back to position 0 only when no filter was requested.
function leadAuthorship(work, preferredCountryIso2) {
  if (preferredCountryIso2) {
    const matching = work.authorships?.find((authorship) =>
      authorship.institutions?.some((inst) => inst.country_code === preferredCountryIso2)
    );
    if (matching) return matching;
  }
  return work.authorships?.[0] ?? null;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function fetchWorksPage({ searchTerm, countryIso2, perPage }) {
  const params = new URLSearchParams({
    search: searchTerm,
    per_page: String(perPage),
    mailto: CONTACT_EMAIL,
  });
  if (countryIso2) {
    params.set("filter", `institutions.country_code:${countryIso2.toUpperCase()}`);
  }
  const url = `https://api.openalex.org/works?${params.toString()}`;
  const data = await fetchJson(url, { fetchOptions: { email: CONTACT_EMAIL, retries: 3, timeout: 20000 } });
  return data.results ?? [];
}

export function buildCandidate(work, { searchTerm, discoveryMethod, preferredCountryIso2 }) {
  const lead = leadAuthorship(work, preferredCountryIso2);
  const institution = preferredCountryIso2
    ? lead?.institutions?.find((inst) => inst.country_code === preferredCountryIso2) ?? lead?.institutions?.[0]
    : lead?.institutions?.[0];
  const sourceUrl = bestSourceUrl(work);
  // Phase 1 (docs/GLOBAL_RESEARCH_SOURCE_STRATEGY.md): every candidate is
  // stamped with the credibility classification of its own sourceUrl -
  // informational for the human reviewer, never a silent filter here.
  const credibility = classifySourceCredibility(sourceUrl);

  return {
    title: work.title || "",
    country: null, // resolved by the caller via the country registry, once countryIso2 is known
    countryIso2: institution?.country_code ?? null,
    institution: institution?.display_name ?? "unknown",
    sourceUrl,
    sourceName: "OpenAlex",
    sourceCredibilityTier: credibility.credibilityTier,
    sourceAccessType: credibility.accessType,
    sourceCredibilityReason: credibility.reason,
    publicationYear: work.publication_year ?? null,
    recordType: "publication",
    abstract: reconstructAbstract(work.abstract_inverted_index),
    summary: "",
    topics: (work.concepts ?? []).slice(0, 5).map((c) => c.display_name),
    technologyTags: (work.concepts ?? []).slice(0, 3).map((c) => c.display_name),
    maritimeRelevance: `Matched search term: "${searchTerm}"`,
    sourceProvenance: `OpenAlex work ${work.id}, fetched ${nowIso()}`,
    discoveryMethod,
    duplicateOf: null,
    status: "candidate",
  };
}

export async function discoverResearchGlobal({
  limit = DEFAULT_LIMIT,
  topicsPerRun = DEFAULT_TOPICS_PER_RUN,
  country,
  missingCountriesOnly = false,
  countriesCount,
  dryRun = false,
  log = console.log,
} = {}) {
  const openAlexSource = getSourceById("openalex");
  if (!openAlexSource?.enabled) {
    throw new Error('Source registry entry "openalex" is missing or not enabled - refusing to query a source the registry does not recognize as safe.');
  }
  log(`  Using registered source: ${openAlexSource.sourceName} (${openAlexSource.accessType}, ${openAlexSource.credibilityTier} credibility)`);

  const productionRecords = (await readJsonIfExists(productionRecordsPath))?.records ?? [];
  const existingByUrl = new Set(productionRecords.flatMap((r) => (r.sourceUrls?.length ? r.sourceUrls : r.sourceUrl ? [r.sourceUrl] : [])).map(normalizeUrl));
  const existingByTitle = new Map(productionRecords.map((r) => [normalizeTitle(r.title), r.recordId]));

  const registryCountries = countryRegistryData.countries ?? [];
  const countryByIso2 = new Map(registryCountries.filter((c) => c.iso2).map((c) => [c.iso2, c]));

  let searchPasses = [];
  if (country) {
    const entry = registryCountries.find((c) => c.countryName.toLowerCase() === country.toLowerCase());
    if (!entry?.iso2) {
      throw new Error(`Country "${country}" not found in the country registry, or has no ISO2 code - refusing to guess a filter.`);
    }
    searchPasses = DISCOVERY_TOPIC_QUERIES.slice(0, topicsPerRun).map((term) => ({ searchTerm: term, countryIso2: entry.iso2, discoveryMethod: "openalex-country-topic-search" }));
  } else if (missingCountriesOnly) {
    const targets = registryCountries.filter((c) => c.dataStatus !== "active" && c.iso2).slice(0, countriesCount ?? 3);
    log(`  missing-countries-only: targeting ${targets.length} countries (${targets.map((t) => t.countryName).join(", ")})`);
    targets.forEach((entry) => {
      searchPasses.push({ searchTerm: DISCOVERY_TOPIC_QUERIES[0], countryIso2: entry.iso2, discoveryMethod: "openalex-country-topic-search" });
    });
  } else {
    searchPasses = DISCOVERY_TOPIC_QUERIES.slice(0, topicsPerRun).map((term) => ({ searchTerm: term, countryIso2: null, discoveryMethod: "openalex-topic-search" }));
  }

  const candidates = [];
  const seenUrlsThisRun = new Set();
  let duplicateCount = 0;
  let reviewCount = 0;

  for (const [index, pass] of searchPasses.entries()) {
    if (candidates.length >= limit) break;
    log(`[${index + 1}/${searchPasses.length}] searching OpenAlex: "${pass.searchTerm}"${pass.countryIso2 ? ` (country=${pass.countryIso2})` : ""}`);
    let works = [];
    try {
      works = await fetchWorksPage({ searchTerm: pass.searchTerm, countryIso2: pass.countryIso2, perPage: DEFAULT_PER_TOPIC_PAGE_SIZE });
    } catch (error) {
      log(`  FAILED: ${error.message}`);
      continue;
    }

    for (const work of works) {
      if (candidates.length >= limit) break;
      const candidate = buildCandidate(work, {
        searchTerm: pass.searchTerm,
        discoveryMethod: pass.discoveryMethod,
        preferredCountryIso2: pass.countryIso2,
      });
      const countryEntry = candidate.countryIso2 ? countryByIso2.get(candidate.countryIso2) : null;
      candidate.country = countryEntry?.countryName ?? (candidate.countryIso2 ? candidate.countryIso2 : "unknown");

      const urlKey = normalizeUrl(candidate.sourceUrl);
      const titleKey = normalizeTitle(candidate.title);

      if (!candidate.title || !candidate.sourceUrl) {
        continue; // never keep a candidate missing the two required fields
      }
      if (seenUrlsThisRun.has(urlKey)) {
        continue; // duplicate within this same run - skip silently, not worth reporting twice
      }
      seenUrlsThisRun.add(urlKey);

      if (existingByUrl.has(urlKey)) {
        candidate.status = "rejected";
        candidate.duplicateOf = "existing-production-record (matched by sourceUrl)";
        duplicateCount++;
      } else if (existingByTitle.has(titleKey)) {
        candidate.status = "review";
        candidate.duplicateOf = existingByTitle.get(titleKey);
        reviewCount++;
      }

      candidates.push(candidate);
    }

    if (index < searchPasses.length - 1) {
      await delayMs(500);
    }
  }

  const report = {
    generatedAt: nowIso(),
    command: "discover:research:global",
    isTestOutput: true,
    dryRun,
    limit,
    searchPassesRun: searchPasses.length,
    candidatesFound: candidates.length,
    newCandidateCount: candidates.filter((c) => c.status === "candidate").length,
    duplicateCount,
    reviewCount,
    countriesTargeted: [...new Set(candidates.map((c) => c.country))],
    candidates,
  };

  if (!dryRun) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  return report;
}

function parseArgs(argv) {
  const args = { limit: DEFAULT_LIMIT, dryRun: false, missingCountriesOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--missing-countries-only") args.missingCountriesOnly = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--country") args.country = argv[++i];
    else if (arg.startsWith("--country=")) args.country = arg.slice("--country=".length);
    else if (arg === "--countries") args.countriesCount = Number(argv[++i]);
    else if (arg.startsWith("--countries=")) args.countriesCount = Number(arg.slice("--countries=".length));
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await discoverResearchGlobal({
    limit: args.limit,
    country: args.country,
    missingCountriesOnly: args.missingCountriesOnly,
    countriesCount: args.countriesCount,
    dryRun: args.dryRun,
  });

  console.log("\n" + "=".repeat(60));
  console.log("Global Research Discovery Summary");
  console.log("=".repeat(60));
  console.log(`Mode:                 ${result.dryRun ? "DRY RUN (not written to staging)" : "live"}`);
  console.log(`Search passes run:    ${result.searchPassesRun}`);
  console.log(`Candidates found:     ${result.candidatesFound}`);
  console.log(`  New (candidate):    ${result.newCandidateCount}`);
  console.log(`  Duplicates:         ${result.duplicateCount}`);
  console.log(`  Needs review:       ${result.reviewCount}`);
  console.log(`Countries touched:    ${result.countriesTargeted.join(", ") || "(none)"}`);
  if (!result.dryRun) {
    console.log(`Staging output:       ${path.relative(rootDir, outputPath)}`);
  }
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during discover:research:global:", error);
    process.exitCode = 1;
  });
}
