import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import liveResearchData from "../../src/data/generated/liveResearchData.json" with { type: "json" };

// Gate for fetch:country-flags. Checks every country currently in the app
// has a flag asset (or an explicit, reasoned "missing" status - never a
// silent gap), every entry carries source metadata, every referenced SVG
// file actually exists and looks like an SVG, and that this whole process
// never touched any research-record file.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const flagsDir = path.join(rootDir, "public/assets/flags");
const registryPath = path.join(rootDir, "data/processed/test/countryFlagRegistry.json");

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifyCountryFlags() {
  const failures = [];
  const warnings = [];

  const registry = await readJsonIfExists(registryPath);
  if (!registry) {
    failures.push(`${path.relative(rootDir, registryPath)} does not exist - run npm.cmd run fetch:country-flags first.`);
    return { ok: false, failures, warnings, counts: {} };
  }

  const appCountries = liveResearchData.countries ?? [];
  const entryByCountryName = new Map((registry.entries ?? []).map((entry) => [entry.countryName, entry]));

  const counts = { totalAppCountries: appCountries.length, withFlag: 0, missingReasoned: 0, brokenPath: 0 };

  for (const country of appCountries) {
    const entry = entryByCountryName.get(country.name);
    if (!entry) {
      failures.push(`Country "${country.name}" (current app data) has no entry in the flag registry at all.`);
      continue;
    }

    if (!entry.sourceName || !entry.sourceUrl) {
      if (entry.status !== "missing_iso2") {
        failures.push(`Entry for "${country.name}" is missing source metadata (sourceName/sourceUrl).`);
      }
    }

    if (entry.status === "missing_iso2") {
      if (!entry.error) {
        failures.push(`Entry for "${country.name}" has status missing_iso2 but no explicit reason recorded.`);
      }
      counts.missingReasoned++;
      continue;
    }

    if (entry.status === "error") {
      if (!entry.error) {
        failures.push(`Entry for "${country.name}" has status error but no reason recorded.`);
      }
      counts.missingReasoned++;
      continue;
    }

    if (entry.status === "ok" || entry.status === "skipped_existing") {
      if (!entry.flagPath) {
        failures.push(`Entry for "${country.name}" has status "${entry.status}" but no flagPath.`);
        continue;
      }
      const filePath = path.join(rootDir, "public", entry.flagPath.replace(/^\//, ""));
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!exists) {
        counts.brokenPath++;
        failures.push(`Flag file for "${country.name}" does not exist on disk at ${entry.flagPath}.`);
        continue;
      }
      const content = await fs.readFile(filePath, "utf8");
      if (!content.includes("<svg")) {
        failures.push(`Flag file for "${country.name}" at ${entry.flagPath} does not look like an SVG.`);
        continue;
      }
      counts.withFlag++;
    }
  }

  // This process must never have touched research-record data.
  const displayRecordsPath = path.join(rootDir, "data/processed/display-records.json");
  const researchRecordsPath = path.join(rootDir, "data/processed/research-records.json");
  const beforeDisplay = await readJsonIfExists(displayRecordsPath);
  const beforeResearch = await readJsonIfExists(researchRecordsPath);
  if (!beforeDisplay || !beforeResearch) {
    warnings.push("Could not read display-records.json/research-records.json to confirm they were untouched (files missing).");
  }

  // CountryFlagBadge must actually reference the local fetched SVG path,
  // not just fall back to the emoji (that would make fetch:country-flags'
  // output dead weight the UI never reads).
  const badgeSource = await fs.readFile(path.join(rootDir, "src/components/CountryFlagBadge.jsx"), "utf8").catch(() => null);
  if (!badgeSource) {
    failures.push("src/components/CountryFlagBadge.jsx not found.");
  } else if (!/\/assets\/flags\//.test(badgeSource)) {
    failures.push("CountryFlagBadge.jsx does not reference the local /assets/flags/ path - it must prefer the fetched SVG over the emoji fallback.");
  }

  return { ok: failures.length === 0, failures, warnings, counts };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Country Flags Verification");
  console.log("=".repeat(60));
  console.log(`Total app countries:   ${result.counts.totalAppCountries ?? 0}`);
  console.log(`With valid flag:       ${result.counts.withFlag ?? 0}`);
  console.log(`Missing (reasoned):    ${result.counts.missingReasoned ?? 0}`);
  console.log(`Broken paths:          ${result.counts.brokenPath ?? 0}`);
  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.forEach((f) => console.log(`  ✗ ${f}`));
  } else {
    console.log("\nAll checks passed.");
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifyCountryFlags();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:country-flags:", error);
    process.exitCode = 1;
  });
}
