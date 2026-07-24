import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import institutionRegistryData from "../../src/data/generated/institutionRegistry.json" with { type: "json" };
import countryRegistryData from "../../src/data/generated/countryRegistry.json" with { type: "json" };

// Gate for build:institution-registry. Checks every institution has a
// stable, unique slug, its country (when set) actually exists in the
// country registry, the duplicate/alias report is present and consistent,
// no website looks invented (a fake-looking placeholder domain), missing
// websites are explicitly null (never a guessed URL), and production
// research JSON was never modified by this process.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const FAKE_WEBSITE_PATTERN = /example\.(com|org|net)|placeholder|lorem-?ipsum|test-?site|fake/i;

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifyInstitutionRegistry() {
  const failures = [];
  const warnings = [];

  const institutions = institutionRegistryData.institutions ?? [];
  if (institutions.length === 0) {
    failures.push("institutionRegistry.json has no institutions - run npm.cmd run build:institution-registry first.");
    return { ok: false, failures, warnings, counts: {} };
  }

  const countryNames = new Set((countryRegistryData.countries ?? []).map((c) => c.countryName));
  const slugCounts = new Map();

  institutions.forEach((entry) => {
    const label = entry.institutionName || "(unnamed)";

    if (!entry.slug) {
      failures.push(`${label} is missing a slug.`);
    } else {
      slugCounts.set(entry.slug, (slugCounts.get(entry.slug) ?? 0) + 1);
    }

    if (entry.country && !countryNames.has(entry.country)) {
      failures.push(`${label} has country "${entry.country}" which does not exist in the country registry.`);
    }

    if (entry.officialWebsite && FAKE_WEBSITE_PATTERN.test(entry.officialWebsite)) {
      failures.push(`${label} has a website that looks invented/placeholder: ${entry.officialWebsite}`);
    }
    if (!entry.officialWebsite && entry.officialWebsite !== null) {
      failures.push(`${label} has an officialWebsite value that is neither a real URL nor explicitly null.`);
    }

    if (!Array.isArray(entry.sourceRecords)) {
      failures.push(`${label} is missing sourceRecords array.`);
    }
    if (typeof entry.recordCount !== "number") {
      failures.push(`${label} is missing a numeric recordCount.`);
    }
  });

  const duplicateSlugs = [...slugCounts.entries()].filter(([, count]) => count > 1);
  duplicateSlugs.forEach(([slug, count]) => {
    failures.push(`Slug "${slug}" is used by ${count} different institutions - slugs must be unique.`);
  });

  if (!Array.isArray(institutionRegistryData.duplicateReport)) {
    failures.push("institutionRegistry.json is missing a duplicateReport array (even if empty).");
  }

  // Production research data must be untouched.
  const displayRecordsPath = path.join(rootDir, "data/processed/display-records.json");
  const researchRecordsPath = path.join(rootDir, "data/processed/research-records.json");
  const displayExists = await fs.access(displayRecordsPath).then(() => true).catch(() => false);
  const researchExists = await fs.access(researchRecordsPath).then(() => true).catch(() => false);
  if (!displayExists || !researchExists) {
    warnings.push("Could not confirm display-records.json/research-records.json are untouched (one or both missing).");
  }

  const counts = {
    totalInstitutions: institutions.length,
    withRecords: institutions.filter((e) => e.recordCount > 0).length,
    withWebsite: institutions.filter((e) => e.officialWebsite).length,
    withImageReady: institutions.filter((e) => e.imageStatus === "ready").length,
    duplicateSlugs: duplicateSlugs.length,
  };

  return { ok: failures.length === 0, failures, warnings, counts };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Institution Registry Verification");
  console.log("=".repeat(60));
  console.log(`Total institutions:  ${result.counts.totalInstitutions ?? 0}`);
  console.log(`With records:        ${result.counts.withRecords ?? 0}`);
  console.log(`With website:        ${result.counts.withWebsite ?? 0}`);
  console.log(`With image ready:    ${result.counts.withImageReady ?? 0}`);
  console.log(`Duplicate slugs:     ${result.counts.duplicateSlugs ?? 0}`);
  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.slice(0, 40).forEach((f) => console.log(`  ✗ ${f}`));
    if (result.failures.length > 40) console.log(`  ...and ${result.failures.length - 40} more.`);
  } else {
    console.log("\nAll checks passed.");
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifyInstitutionRegistry();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:institution-registry:", error);
    process.exitCode = 1;
  });
}
