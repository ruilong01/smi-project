import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import liveResearchData from "../../src/data/generated/liveResearchData.json" with { type: "json" };
import { delayMs } from "./http.mjs";

// Fetches a real national flag SVG per country ISO2 code from a documented
// public flag CDN - no AI, no random image search, one deterministic URL
// per code. Only ever touches public/assets/flags/ and its own registry
// file; never reads or writes any research-record data.
//
// Scoped to the countries already present in the current app data (24
// today, via src/data/generated/liveResearchData.json) - NOT a hardcoded
// list - so raising the country count later (the 117-country expansion,
// explicitly out of scope for this task) only means re-running this same
// script against the larger generated dataset, no code change needed here.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const flagsDir = path.join(rootDir, "public/assets/flags");
// Metadata is regenerated data, not a source-of-truth research record -
// kept out of the committed tree by default per the data-snapshot policy
// (docs/DATA_SNAPSHOT_POLICY.md) until explicitly promoted.
const registryPath = path.join(rootDir, "data/processed/test/countryFlagRegistry.json");

const FLAG_SOURCE_NAME = "Flagpedia / flagcdn.com";
const flagUrlFor = (iso2) => `https://flagcdn.com/${iso2.toLowerCase()}.svg`;

const REQUEST_TIMEOUT_MS = 15000;
const REQUEST_DELAY_MS = 300;

function nowIso() {
  return new Date().toISOString();
}

async function fileExists(filePath) {
  return fs.access(filePath).then(
    () => true,
    () => false
  );
}

async function downloadFlag(iso2) {
  const url = flagUrlFor(iso2);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "GlobalMaritimeResearchIntelligenceMap/0.3 (flag-fetch-feasibility-test)" },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return { status: "error", error: `HTTP ${response.status} ${response.statusText}`, sourceUrl: url };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/svg|image/i.test(contentType)) {
      return { status: "error", error: `Unexpected content-type: ${contentType}`, sourceUrl: url };
    }
    const svgText = await response.text();
    if (!svgText.includes("<svg")) {
      return { status: "error", error: "Response body does not look like SVG", sourceUrl: url };
    }
    return { status: "ok", svgText, sourceUrl: url };
  } catch (error) {
    clearTimeout(timeoutId);
    return { status: "error", error: error.message, sourceUrl: url };
  }
}

export async function fetchCountryFlags({ force = false, log = console.log } = {}) {
  await fs.mkdir(flagsDir, { recursive: true });
  await fs.mkdir(path.dirname(registryPath), { recursive: true });

  const countries = liveResearchData.countries ?? [];
  const entries = [];
  let fetchedCount = 0;
  let skippedExistingCount = 0;
  let errorCount = 0;
  let missingIso2Count = 0;

  for (const [index, country] of countries.entries()) {
    const iso2 = country.code;
    if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) {
      missingIso2Count++;
      entries.push({
        countryName: country.name,
        iso2: iso2 ?? null,
        flagPath: null,
        sourceName: FLAG_SOURCE_NAME,
        sourceUrl: null,
        fetchedAt: nowIso(),
        status: "missing_iso2",
        error: "No valid ISO2 code on this country record - cannot fetch a flag without one.",
      });
      continue;
    }

    const lower = iso2.toLowerCase();
    const filePath = path.join(flagsDir, `${lower}.svg`);
    const flagPath = `/assets/flags/${lower}.svg`;

    if ((await fileExists(filePath)) && !force) {
      skippedExistingCount++;
      entries.push({
        countryName: country.name,
        iso2,
        flagPath,
        sourceName: FLAG_SOURCE_NAME,
        sourceUrl: flagUrlFor(iso2),
        fetchedAt: nowIso(),
        status: "skipped_existing",
        error: null,
      });
      continue;
    }

    log(`  [${index + 1}/${countries.length}] fetching flag for ${country.name} (${iso2})`);
    const result = await downloadFlag(iso2);
    if (result.status === "ok") {
      await fs.writeFile(filePath, result.svgText);
      fetchedCount++;
      entries.push({
        countryName: country.name,
        iso2,
        flagPath,
        sourceName: FLAG_SOURCE_NAME,
        sourceUrl: result.sourceUrl,
        fetchedAt: nowIso(),
        status: "ok",
        error: null,
      });
    } else {
      errorCount++;
      entries.push({
        countryName: country.name,
        iso2,
        flagPath: null,
        sourceName: FLAG_SOURCE_NAME,
        sourceUrl: result.sourceUrl,
        fetchedAt: nowIso(),
        status: "error",
        error: result.error,
      });
      log(`    FAILED: ${result.error}`);
    }

    if (index < countries.length - 1) {
      await delayMs(REQUEST_DELAY_MS);
    }
  }

  const registry = {
    generatedAt: nowIso(),
    command: "fetch:country-flags",
    isTestOutput: true,
    totalCountries: countries.length,
    fetchedCount,
    skippedExistingCount,
    errorCount,
    missingIso2Count,
    entries,
  };
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  return registry;
}

function parseArgs(argv) {
  return { force: argv.includes("--force") };
}

async function main() {
  const { force } = parseArgs(process.argv.slice(2));
  const result = await fetchCountryFlags({ force });

  console.log("\n" + "=".repeat(60));
  console.log("Country Flag Fetch Summary");
  console.log("=".repeat(60));
  console.log(`Total countries:      ${result.totalCountries}`);
  console.log(`Fetched (new):        ${result.fetchedCount}`);
  console.log(`Skipped (existing):   ${result.skippedExistingCount}`);
  console.log(`Missing ISO2:         ${result.missingIso2Count}`);
  console.log(`Errors:               ${result.errorCount}`);
  console.log(`Registry written to:  ${path.relative(rootDir, registryPath)}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during fetch:country-flags:", error);
    process.exitCode = 1;
  });
}
