import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import liveResearchData from "../../src/data/generated/liveResearchData.json" with { type: "json" };
import { COUNTRY_SEED_LIST } from "./countrySeedList.mjs";

// Builds a scalable country registry: merges the real ISO reference seed
// list (COUNTRY_SEED_LIST - ~170 real countries, "structure for the
// eventual ~117-country target") with whatever countries the app's actual
// current research data covers. A country only ever gets marked
// enabled/active because it has REAL research records behind it - a
// country with no records yet is never faked into looking populated; it
// gets dataStatus: "no-data" and stays that way until a real record
// exists for it (see docs/GLOBAL_DATA_AND_IMAGE_EXPANSION_PLAN.md).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const outputPath = path.join(rootDir, "src/data/generated/countryRegistry.json");

function normalizeName(name) {
  return (name || "").trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

export async function buildCountryRegistry({ log = console.log } = {}) {
  const appCountries = liveResearchData.countries ?? [];
  const appByNormalizedName = new Map(appCountries.map((country) => [normalizeName(country.name), country]));
  const seedByNormalizedName = new Map(COUNTRY_SEED_LIST.map((seed) => [normalizeName(seed.countryName), seed]));

  const missingFromSeed = [];
  const entries = [];
  const seenNames = new Set();

  // Every seed-list country becomes a registry entry - enabled/active only
  // if the app's real data already has research records for it.
  COUNTRY_SEED_LIST.forEach((seed) => {
    const key = normalizeName(seed.countryName);
    seenNames.add(key);
    const appCountry = appByNormalizedName.get(key);
    const recordCount = appCountry?.activity?.verifiedProjects ?? 0;

    entries.push({
      countryName: seed.countryName,
      iso2: seed.iso2,
      iso3: seed.iso3,
      region: seed.region,
      subregion: seed.subregion,
      flagPath: `/assets/flags/${seed.iso2.toLowerCase()}.svg`,
      enabled: Boolean(appCountry),
      dataStatus: appCountry ? (recordCount > 0 ? "active" : "pending") : "no-data",
      recordCount,
      source: appCountry ? "app-data" : "seed-list",
    });
  });

  // Any app-data country whose name didn't match the seed list at all -
  // reported clearly rather than silently dropped or guessed at.
  appCountries.forEach((country) => {
    const key = normalizeName(country.name);
    if (!seedByNormalizedName.has(key)) {
      missingFromSeed.push(country.name);
      entries.push({
        countryName: country.name,
        iso2: country.code ?? null,
        iso3: null,
        region: null,
        subregion: null,
        flagPath: country.code ? `/assets/flags/${country.code.toLowerCase()}.svg` : null,
        enabled: true,
        dataStatus: (country.activity?.verifiedProjects ?? 0) > 0 ? "active" : "pending",
        recordCount: country.activity?.verifiedProjects ?? 0,
        source: "app-data-unmatched",
      });
      log(`  ⚠ "${country.name}" is in app data but not in the seed list - added directly from app data (iso3/region unknown).`);
    }
  });

  const registry = {
    generatedAt: nowIso(),
    command: "build:country-registry",
    totalCountries: entries.length,
    enabledCountries: entries.filter((e) => e.enabled).length,
    activeCountries: entries.filter((e) => e.dataStatus === "active").length,
    missingFromSeedCount: missingFromSeed.length,
    missingFromSeed,
    countries: entries,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`);

  return registry;
}

async function main() {
  const result = await buildCountryRegistry();
  console.log("\n" + "=".repeat(60));
  console.log("Country Registry Build Summary");
  console.log("=".repeat(60));
  console.log(`Total countries in registry: ${result.totalCountries}`);
  console.log(`Enabled (in app data):       ${result.enabledCountries}`);
  console.log(`Active (has records):        ${result.activeCountries}`);
  console.log(`Unmatched app-data names:    ${result.missingFromSeedCount}`);
  if (result.missingFromSeed.length) {
    console.log(`  ${result.missingFromSeed.join(", ")}`);
  }
  console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during build:country-registry:", error);
    process.exitCode = 1;
  });
}
