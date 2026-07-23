import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRY_COORDINATES, DEFAULT_DISPLAY_FROM_DATE, LATEST_HIGHLIGHT_FROM_DATE } from "./config.mjs";
import { slugify } from "./normalization.mjs";

// Aggregates data/processed/research-records.json into
// data/processed/country-profiles.json - one entry per country that has at
// least one record with a real, source-derived country attribution.
// Countries with zero attributed records simply don't appear here; the
// frontend's existing "coverage pending" treatment (see src/utils/
// intensity.js) already covers what to show for every country NOT in this
// list, so this step does not need to enumerate them.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultInputDir = path.join(rootDir, "data/processed");
const defaultOutputDir = path.join(rootDir, "data/processed");

function isOnOrAfter(dateValue, thresholdDate) {
  if (!dateValue) return false;
  const parsed = new Date(dateValue);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed >= new Date(thresholdDate);
}

export async function buildCountryProfiles({
  inputDir = defaultInputDir,
  outputDir = defaultOutputDir,
  nowIso = new Date().toISOString(),
} = {}) {
  const researchRecordsPath = path.join(inputDir, "research-records.json");
  const researchRecordsRaw = JSON.parse(await fs.readFile(researchRecordsPath, "utf8"));
  const records = researchRecordsRaw.records ?? [];

  const byCountry = new Map();

  records.forEach((record) => {
    if (!record.countryCode) return;

    if (!byCountry.has(record.countryCode)) {
      byCountry.set(record.countryCode, {
        countryCode: record.countryCode,
        countryName: record.countryName,
        slug: slugify(record.countryName ?? record.countryCode),
        coordinates: COUNTRY_COORDINATES[record.countryCode] ?? null,
        recordCount: 0,
        recordsSince2020: 0,
        recordsSince2024: 0,
        institutions: new Set(),
        categories: new Set(),
        verifiedCount: 0,
        recordIds: [],
      });
    }

    const entry = byCountry.get(record.countryCode);
    entry.recordCount += 1;
    if (isOnOrAfter(record.publicationDate, DEFAULT_DISPLAY_FROM_DATE)) entry.recordsSince2020 += 1;
    if (isOnOrAfter(record.publicationDate, LATEST_HIGHLIGHT_FROM_DATE)) entry.recordsSince2024 += 1;
    if (record.institution) entry.institutions.add(record.institution);
    (record.categories ?? []).forEach((category) => entry.categories.add(category));
    if (record.verificationStatus === "verified") entry.verifiedCount += 1;
    entry.recordIds.push(record.recordId);
  });

  const countries = [...byCountry.values()];
  const maxRecordCount = Math.max(...countries.map((c) => c.recordCount), 1);

  const profiles = countries
    .map((entry) => ({
      countryCode: entry.countryCode,
      countryName: entry.countryName,
      slug: entry.slug,
      coordinates: entry.coordinates,
      recordCount: entry.recordCount,
      recordsSince2020: entry.recordsSince2020,
      recordsSince2024: entry.recordsSince2024,
      verifiedCount: entry.verifiedCount,
      // Same lean-MVP formula as buildDataset.mjs's buildCountries - record
      // count dominates, relative to whichever country currently has the
      // most, never an absolute/official measure.
      researchIntensity: Math.round((entry.recordCount / maxRecordCount) * 100),
      institutions: [...entry.institutions],
      categories: [...entry.categories],
      recordIds: entry.recordIds,
    }))
    .sort((a, b) => b.recordCount - a.recordCount);

  await fs.mkdir(outputDir, { recursive: true });

  const output = {
    generatedAt: nowIso,
    sourceResearchRecordsGeneratedAt: researchRecordsRaw.generatedAt,
    countryCount: profiles.length,
    profiles,
  };

  const outputPath = path.join(outputDir, "country-profiles.json");
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(
    `[build:country-profiles] ${profiles.length} countries from ${records.length} records -> ${path.relative(rootDir, outputPath)}`
  );

  return { outputPath, countryCount: profiles.length };
}

async function main() {
  await buildCountryProfiles();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during country profile build:", error);
    process.exitCode = 1;
  });
}
