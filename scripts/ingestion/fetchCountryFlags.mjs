import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import countryRegistryData from "../../src/data/generated/countryRegistry.json" with { type: "json" };
import { delayMs } from "./http.mjs";

// Fetches a real national flag SVG per country ISO2 code from a documented
// public flag CDN - no AI, no random image search, one deterministic URL
// per code. Only ever touches public/assets/flags/ and its own registry
// file; never reads or writes any research-record data.
//
// Reads from src/data/generated/countryRegistry.json (built by
// build:country-registry - run that first if it's stale) instead of the
// app's live research data directly, so this now naturally scales with
// the country registry rather than needing a code change every time the
// registry grows (the whole point of Step 1). By default only fetches for
// "enabled" countries (the ones the app currently has data for, 24 today)
// - pass --all to sweep the full registry (~170 countries, still a small/
// safe batch since flags are tiny SVGs).

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

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function downloadFlag(iso2) {
  const url = flagUrlFor(iso2);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "GlobalMaritimeResearchIntelligenceMap/0.3 (flag-fetch)" },
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

export async function fetchCountryFlags({ force = false, all = false, missingOnly = false, log = console.log } = {}) {
  await fs.mkdir(flagsDir, { recursive: true });
  await fs.mkdir(path.dirname(registryPath), { recursive: true });

  const registryCountries = countryRegistryData.countries ?? [];
  let candidates = all ? registryCountries : registryCountries.filter((c) => c.enabled);

  if (missingOnly) {
    const stillMissing = [];
    for (const country of candidates) {
      if (!country.iso2) {
        stillMissing.push(country);
        continue;
      }
      const exists = await fileExists(path.join(flagsDir, `${country.iso2.toLowerCase()}.svg`));
      if (!exists) stillMissing.push(country);
    }
    candidates = stillMissing;
  }

  const entries = [];
  let fetchedCount = 0;
  let skippedExistingCount = 0;
  let errorCount = 0;
  let missingIso2Count = 0;

  for (const [index, country] of candidates.entries()) {
    const iso2 = country.iso2;
    if (!iso2 || !/^[A-Za-z]{2}$/.test(iso2)) {
      missingIso2Count++;
      entries.push({
        countryName: country.countryName,
        iso2: iso2 ?? null,
        flagPath: null,
        sourceName: FLAG_SOURCE_NAME,
        sourceUrl: null,
        fetchedAt: nowIso(),
        status: "missing_iso2",
        error: "No valid ISO2 code on this country registry entry - cannot fetch a flag without one.",
      });
      continue;
    }

    const lower = iso2.toLowerCase();
    const filePath = path.join(flagsDir, `${lower}.svg`);
    const flagPath = `/assets/flags/${lower}.svg`;

    if ((await fileExists(filePath)) && !force) {
      skippedExistingCount++;
      entries.push({
        countryName: country.countryName,
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

    log(`  [${index + 1}/${candidates.length}] fetching flag for ${country.countryName} (${iso2})`);
    const result = await downloadFlag(iso2);
    if (result.status === "ok") {
      await fs.writeFile(filePath, result.svgText);
      fetchedCount++;
      entries.push({
        countryName: country.countryName,
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
        countryName: country.countryName,
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

    if (index < candidates.length - 1) {
      await delayMs(REQUEST_DELAY_MS);
    }
  }

  // Merge into whatever the registry already recorded, rather than
  // overwriting wholesale - a --missing-only or narrower run must never
  // erase a previous run's entries for countries it didn't touch this
  // time (e.g. an --all --missing-only sweep of the long tail must not
  // wipe out the 24 "enabled" countries' entries from an earlier run).
  const previousRegistry = await readJsonIfExists(registryPath);
  const mergedByName = new Map((previousRegistry?.entries ?? []).map((entry) => [entry.countryName, entry]));
  entries.forEach((entry) => mergedByName.set(entry.countryName, entry));
  const mergedEntries = [...mergedByName.values()];

  const registry = {
    generatedAt: nowIso(),
    command: "fetch:country-flags",
    isTestOutput: true,
    lastRunMode: all ? "all" : "enabled-only",
    lastRunMissingOnly: missingOnly,
    lastRunCandidates: candidates.length,
    fetchedCount,
    skippedExistingCount,
    errorCount,
    missingIso2Count,
    totalEntries: mergedEntries.length,
    entries: mergedEntries,
  };
  await fs.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);

  return registry;
}

function parseArgs(argv) {
  return {
    force: argv.includes("--force"),
    all: argv.includes("--all"),
    missingOnly: argv.includes("--missing-only"),
  };
}

async function main() {
  const { force, all, missingOnly } = parseArgs(process.argv.slice(2));
  const result = await fetchCountryFlags({ force, all, missingOnly });

  console.log("\n" + "=".repeat(60));
  console.log("Country Flag Fetch Summary");
  console.log("=".repeat(60));
  console.log(`Mode:                 ${result.lastRunMode}${result.lastRunMissingOnly ? " (missing-only)" : ""}`);
  console.log(`This run's candidates: ${result.lastRunCandidates}`);
  console.log(`Fetched (new):        ${result.fetchedCount}`);
  console.log(`Skipped (existing):   ${result.skippedExistingCount}`);
  console.log(`Missing ISO2:         ${result.missingIso2Count}`);
  console.log(`Errors:               ${result.errorCount}`);
  console.log(`Total entries in registry: ${result.totalEntries}`);
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
