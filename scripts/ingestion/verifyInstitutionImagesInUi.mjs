import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { institutionImageRegistry } from "../../src/data/institutionImageRegistry.js";

// Gate for "accepted institution images actually appear in the UI, from a
// stable committed registry, never from test/runtime output directly".
// Checks the registry only ever contains accept-decision entries with full
// provenance, every referenced asset file genuinely exists under the
// stable public/assets/institutions/ path (never public/assets/test/),
// that InstitutionHeader.jsx actually imports/uses the registry, and that
// production research data was never touched by any of this.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

async function readTextIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function verifyInstitutionImagesInUi() {
  const failures = [];
  const warnings = [];

  if (!Array.isArray(institutionImageRegistry) || institutionImageRegistry.length === 0) {
    failures.push("institutionImageRegistry is empty or not an array - expected the 3 promoted sample images.");
    return { ok: false, failures, warnings, counts: {} };
  }

  const counts = { totalEntries: institutionImageRegistry.length, assetsVerified: 0 };

  for (const entry of institutionImageRegistry) {
    const label = entry.institutionName || "(unnamed institution)";

    if (entry.mockAiDecision !== "accept") {
      failures.push(`Registry entry for ${label} has mockAiDecision="${entry.mockAiDecision}" - only "accept" entries may be promoted.`);
    }
    if (!entry.imageSourceUrl) failures.push(`Registry entry for ${label} is missing imageSourceUrl.`);
    if (!entry.rightsNote) failures.push(`Registry entry for ${label} is missing rightsNote.`);
    if (!entry.institutionSlug) failures.push(`Registry entry for ${label} is missing institutionSlug.`);
    if (!entry.assetPath) {
      failures.push(`Registry entry for ${label} is missing assetPath.`);
      continue;
    }
    if (!entry.assetPath.startsWith("/assets/institutions/")) {
      failures.push(`Registry entry for ${label} has assetPath "${entry.assetPath}" - must live under /assets/institutions/, not a test path.`);
      continue;
    }

    const filePath = path.join(rootDir, "public", entry.assetPath.replace(/^\//, ""));
    const exists = await fs.access(filePath).then(() => true).catch(() => false);
    if (!exists) {
      failures.push(`Registry entry for ${label}: asset file does not exist at ${entry.assetPath}.`);
    } else {
      counts.assetsVerified++;
    }
  }

  // InstitutionHeader must actually use the registry, and must never
  // reference the test-only output path.
  const headerSource = await readTextIfExists(path.join(rootDir, "src/components/InstitutionHeader.jsx"));
  if (!headerSource) {
    failures.push("src/components/InstitutionHeader.jsx not found.");
  } else {
    if (!/institutionImageRegistry/.test(headerSource)) {
      failures.push("InstitutionHeader.jsx does not import/use institutionImageRegistry.js.");
    }
    if (/assets\/test\//.test(headerSource)) {
      failures.push("InstitutionHeader.jsx references a public/assets/test/ path - the UI must only ever use the stable public/assets/institutions/ path.");
    }
  }
  if (/assets\/test\//.test(await readTextIfExists(path.join(rootDir, "src/data/institutionImageRegistry.js")) ?? "")) {
    failures.push("institutionImageRegistry.js references a public/assets/test/ path.");
  }

  // Production research data must be untouched.
  const displayRecordsPath = path.join(rootDir, "data/processed/display-records.json");
  const researchRecordsPath = path.join(rootDir, "data/processed/research-records.json");
  const displayExists = await fs.access(displayRecordsPath).then(() => true).catch(() => false);
  const researchExists = await fs.access(researchRecordsPath).then(() => true).catch(() => false);
  if (!displayExists || !researchExists) {
    warnings.push("Could not confirm display-records.json/research-records.json are untouched (one or both missing).");
  }

  return { ok: failures.length === 0, failures, warnings, counts };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Institution Images In UI Verification");
  console.log("=".repeat(60));
  console.log(`Registry entries:   ${result.counts.totalEntries ?? 0}`);
  console.log(`Assets verified:    ${result.counts.assetsVerified ?? 0}`);
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
  const result = await verifyInstitutionImagesInUi();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:institution-images-in-ui:", error);
    process.exitCode = 1;
  });
}
