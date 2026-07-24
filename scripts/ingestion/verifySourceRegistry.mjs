import path from "node:path";
import { fileURLToPath } from "node:url";
import { GLOBAL_SOURCE_REGISTRY } from "./globalSourceRegistry.mjs";

// Gate for the global research source registry. Checks every entry has
// the required fields, sourceId is unique, accessType/credibilityTier are
// from the known enums, no baseUrl looks invented/placeholder, and that
// license-required/restricted sources are never marked `enabled: true`
// (this pipeline must never silently start "using" a source that needs a
// license it doesn't have).

const VALID_ACCESS_TYPES = ["public-api", "public-website", "license-required", "restricted"];
const VALID_CREDIBILITY_TIERS = ["high", "medium", "low"];
const FAKE_URL_PATTERN = /example\.(com|org|net)|placeholder|lorem-?ipsum|test-?site|fake/i;

export async function verifySourceRegistry() {
  const failures = [];
  const warnings = [];

  if (!Array.isArray(GLOBAL_SOURCE_REGISTRY) || GLOBAL_SOURCE_REGISTRY.length === 0) {
    failures.push("GLOBAL_SOURCE_REGISTRY is empty or not an array.");
    return { ok: false, failures, warnings, counts: {} };
  }

  const seenIds = new Set();
  GLOBAL_SOURCE_REGISTRY.forEach((source) => {
    const label = source.sourceName || source.sourceId || "(unnamed source)";

    if (!source.sourceId) {
      failures.push(`${label} is missing sourceId.`);
    } else if (seenIds.has(source.sourceId)) {
      failures.push(`Duplicate sourceId: "${source.sourceId}".`);
    } else {
      seenIds.add(source.sourceId);
    }

    if (!source.sourceName) failures.push(`${label} is missing sourceName.`);
    if (!source.sourceType) failures.push(`${label} is missing sourceType.`);
    if (!Array.isArray(source.dataTypes)) failures.push(`${label} is missing a dataTypes array.`);
    if (typeof source.enabled !== "boolean") failures.push(`${label} is missing a boolean enabled flag.`);
    if (!source.credibilityReason) failures.push(`${label} is missing credibilityReason.`);

    if (!VALID_ACCESS_TYPES.includes(source.accessType)) {
      failures.push(`${label} has invalid accessType "${source.accessType}" - must be one of ${VALID_ACCESS_TYPES.join(", ")}.`);
    }
    if (!VALID_CREDIBILITY_TIERS.includes(source.credibilityTier)) {
      failures.push(`${label} has invalid credibilityTier "${source.credibilityTier}" - must be one of ${VALID_CREDIBILITY_TIERS.join(", ")}.`);
    }

    if (source.baseUrl && FAKE_URL_PATTERN.test(source.baseUrl)) {
      failures.push(`${label} has a baseUrl that looks invented/placeholder: ${source.baseUrl}`);
    }

    if (source.enabled && (source.accessType === "license-required" || source.accessType === "restricted")) {
      failures.push(`${label} is marked enabled=true but has accessType="${source.accessType}" - a source requiring a license/restricted access must never be auto-enabled.`);
    }
  });

  const counts = {
    total: GLOBAL_SOURCE_REGISTRY.length,
    enabled: GLOBAL_SOURCE_REGISTRY.filter((s) => s.enabled).length,
    publicApi: GLOBAL_SOURCE_REGISTRY.filter((s) => s.accessType === "public-api").length,
    licenseRequired: GLOBAL_SOURCE_REGISTRY.filter((s) => s.accessType === "license-required").length,
    restricted: GLOBAL_SOURCE_REGISTRY.filter((s) => s.accessType === "restricted").length,
  };

  return { ok: failures.length === 0, failures, warnings, counts };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Source Registry Verification");
  console.log("=".repeat(60));
  console.log(`Total sources:        ${result.counts.total ?? 0}`);
  console.log(`Enabled:              ${result.counts.enabled ?? 0}`);
  console.log(`Public API:           ${result.counts.publicApi ?? 0}`);
  console.log(`License-required:     ${result.counts.licenseRequired ?? 0}`);
  console.log(`Restricted:           ${result.counts.restricted ?? 0}`);
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.forEach((f) => console.log(`  ✗ ${f}`));
  } else {
    console.log("\nAll checks passed.");
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifySourceRegistry();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:source-registry:", error);
    process.exitCode = 1;
  });
}
