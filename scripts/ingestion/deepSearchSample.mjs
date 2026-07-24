import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import countryRegistryData from "../../src/data/generated/countryRegistry.json" with { type: "json" };
import { fetchWorksPage, buildCandidate, normalizeUrl, normalizeTitle } from "./discoverResearchGlobal.mjs";
import { classifySourceCredibility } from "../processing/sourceCredibilityClassifier.mjs";
import { MPA_SOURCES } from "./config.mjs";
import { delayMs } from "./http.mjs";

// Phase 4 of the global research scanner (see docs/DEEP_SEARCH_DESIGN.md):
// a small, staged demonstration of "deep search" for ONE country+topic
// pair - Singapore + smart port, by default - combining several real
// query variants (not just one flat term) with the country's already-
// known official reference pages (MPA_SOURCES, real URLs already used
// elsewhere in this app's config). Reuses discoverResearchGlobal.mjs's
// exact fetch/candidate-building/credibility logic rather than
// duplicating it. Staging output only
// (data/processed/test/deep-search-sample.json); never touches
// production research-records.json/display-records.json.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const outputPath = path.join(rootDir, "data/processed/test/deep-search-sample.json");
const productionRecordsPath = path.join(rootDir, "data/processed/research-records.json");

const DEFAULT_COUNTRY = "Singapore";
const DEFAULT_TOPIC = "smart port";
const DEFAULT_LIMIT = 15;
const PER_VARIANT_PAGE_SIZE = 5;

function nowIso() {
  return new Date().toISOString();
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

// "Deep search" = several real angles on the same theme, not one flat
// term - a base search engine query would just be the topic itself.
function buildQueryVariants(topic, countryName) {
  return [topic, `${topic} ${countryName}`, `${topic} digital twin`, `${topic} automation`, `${countryName} port technology research`];
}

export async function deepSearchSample({
  country = DEFAULT_COUNTRY,
  topic = DEFAULT_TOPIC,
  limit = DEFAULT_LIMIT,
  dryRun = false,
  log = console.log,
} = {}) {
  const countryEntry = (countryRegistryData.countries ?? []).find((c) => c.countryName.toLowerCase() === country.toLowerCase());
  if (!countryEntry?.iso2) {
    throw new Error(`Country "${country}" not found in the country registry, or has no ISO2 code - refusing to guess a filter.`);
  }

  const productionRecords = (await readJsonIfExists(productionRecordsPath))?.records ?? [];
  const existingByUrl = new Set(
    productionRecords.flatMap((r) => (r.sourceUrls?.length ? r.sourceUrls : r.sourceUrl ? [r.sourceUrl] : [])).map(normalizeUrl)
  );
  const existingByTitle = new Map(productionRecords.map((r) => [normalizeTitle(r.title), r.recordId]));

  const variants = buildQueryVariants(topic, country);
  const candidates = [];
  const seenUrlsThisRun = new Set();
  let duplicateCount = 0;

  for (const [index, searchTerm] of variants.entries()) {
    if (candidates.length >= limit) break;
    log(`[query ${index + 1}/${variants.length}] "${searchTerm}" (country=${countryEntry.iso2})`);
    let works = [];
    try {
      works = await fetchWorksPage({ searchTerm, countryIso2: countryEntry.iso2, perPage: PER_VARIANT_PAGE_SIZE });
    } catch (error) {
      log(`  FAILED: ${error.message}`);
      continue;
    }

    for (const work of works) {
      if (candidates.length >= limit) break;
      const candidate = buildCandidate(work, {
        searchTerm,
        discoveryMethod: "deep-search-query-variant",
        preferredCountryIso2: countryEntry.iso2,
      });
      candidate.country = countryEntry.countryName;

      if (!candidate.title || !candidate.sourceUrl) continue;
      const urlKey = normalizeUrl(candidate.sourceUrl);
      if (seenUrlsThisRun.has(urlKey)) continue;
      seenUrlsThisRun.add(urlKey);

      const titleKey = normalizeTitle(candidate.title);
      if (existingByUrl.has(urlKey)) {
        candidate.status = "rejected";
        candidate.duplicateOf = "existing-production-record (matched by sourceUrl)";
        duplicateCount++;
      } else if (existingByTitle.has(titleKey)) {
        candidate.status = "review";
        candidate.duplicateOf = existingByTitle.get(titleKey);
      }

      candidates.push(candidate);
    }

    if (index < variants.length - 1) {
      await delayMs(500);
    }
  }

  // Known official reference pages for this country - a real, additional
  // "deep search" signal beyond structured-API search results, cited
  // directly (never scraped for new content here - that is
  // discoverOfficialSources.mjs's job) with their own credibility rating.
  const officialReferences = country.toLowerCase() === "singapore"
    ? MPA_SOURCES.map((url) => {
        const credibility = classifySourceCredibility(url);
        return {
          sourceUrl: url,
          sourceName: "Maritime and Port Authority of Singapore",
          country: countryEntry.countryName,
          sourceCredibilityTier: credibility.credibilityTier,
          sourceAccessType: credibility.accessType,
          sourceCredibilityReason: credibility.reason,
          discoveryMethod: "known-official-source",
        };
      })
    : [];

  const report = {
    generatedAt: nowIso(),
    command: "deep-search:sample",
    isTestOutput: true,
    dryRun,
    country: countryEntry.countryName,
    countryIso2: countryEntry.iso2,
    topic,
    queryVariantsUsed: variants,
    limit,
    candidatesFound: candidates.length,
    newCandidateCount: candidates.filter((c) => c.status === "candidate").length,
    duplicateCount,
    officialReferencesCount: officialReferences.length,
    candidates,
    officialReferences,
  };

  if (!dryRun) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  return report;
}

function parseArgs(argv) {
  const args = { limit: DEFAULT_LIMIT, dryRun: false, country: DEFAULT_COUNTRY, topic: DEFAULT_TOPIC };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--country") args.country = argv[++i];
    else if (arg.startsWith("--country=")) args.country = arg.slice("--country=".length);
    else if (arg === "--topic") args.topic = argv[++i];
    else if (arg.startsWith("--topic=")) args.topic = arg.slice("--topic=".length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await deepSearchSample(args);

  console.log("\n" + "=".repeat(60));
  console.log("Deep Search Sample Summary");
  console.log("=".repeat(60));
  console.log(`Mode:                 ${result.dryRun ? "DRY RUN (not written to staging)" : "live"}`);
  console.log(`Country / Topic:      ${result.country} / "${result.topic}"`);
  console.log(`Query variants used:  ${result.queryVariantsUsed.length}`);
  console.log(`Candidates found:     ${result.candidatesFound}`);
  console.log(`  New:                ${result.newCandidateCount}`);
  console.log(`  Duplicates:         ${result.duplicateCount}`);
  console.log(`Official references:  ${result.officialReferencesCount}`);
  if (!result.dryRun) {
    console.log(`Staging output:       ${path.relative(rootDir, outputPath)}`);
  }
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during deep-search:sample:", error);
    process.exitCode = 1;
  });
}
