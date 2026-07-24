import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifySourceCredibility } from "../processing/sourceCredibilityClassifier.mjs";

// Gate for the source credibility classifier - a self-contained fixture of
// real, known URLs (never depends on production data), proving the
// classifier actually distinguishes high/medium/low credibility and
// public/license-required/restricted access correctly. Adversarial in the
// same spirit as this codebase's other classifier verifiers (image/
// source-discovery): every case here is a real assertion the classifier
// must get right, not just "does it return something."

const FIXTURE_CASES = [
  { url: "https://api.openalex.org/works/W123", expectTier: "high", expectAccess: "public-api", label: "OpenAlex API" },
  { url: "https://api.crossref.org/works/10.1000/xyz", expectTier: "high", expectAccess: "public-api", label: "Crossref API" },
  { url: "https://cordis.europa.eu/project/id/101138620", expectTier: "high", expectAccess: "public-website", label: "CORDIS project page" },
  { url: "https://www.mpa.gov.sg/maritime-singapore/innovation-and-r-d", expectTier: "high", expectAccess: "public-website", label: "Government (.gov.sg) page" },
  { url: "https://www.ntu.edu.sg/about-us", expectTier: "medium", expectAccess: "public-website", label: "University (.edu.sg) page" },
  { url: "https://doi.org/10.1000/xyz", expectTier: "low", expectAccess: "restricted", label: "DOI resolver" },
  { url: "https://www.mdpi.com/2071-1050/13/1/298", expectTier: "medium", expectAccess: "license-required", label: "Academic publisher article page" },
  { url: "https://www.shutterstock.com/some-photo", expectTier: "low", label: "Stock photo site (unrecognized domain)" },
  { url: "not a url at all", expectTier: "low", label: "Malformed URL" },
];

export async function verifySourceCredibility() {
  const failures = [];
  const warnings = [];
  const checks = [];

  FIXTURE_CASES.forEach((testCase) => {
    const result = classifySourceCredibility(testCase.url);
    const tierOk = result.credibilityTier === testCase.expectTier;
    const accessOk = !testCase.expectAccess || result.accessType === testCase.expectAccess;
    const passed = tierOk && accessOk;
    checks.push({ label: testCase.label, passed, actual: result });
    if (!passed) {
      failures.push(
        `${testCase.label} (${testCase.url}): expected tier="${testCase.expectTier}"${testCase.expectAccess ? `/access="${testCase.expectAccess}"` : ""}, got tier="${result.credibilityTier}"/access="${result.accessType}".`
      );
    }
  });

  // Every distinct domain in the fixture set must actually resolve to a
  // DIFFERENT classification somewhere (proves the classifier isn't just
  // returning one constant value for everything).
  const distinctTiers = new Set(checks.map((c) => c.actual.credibilityTier));
  if (distinctTiers.size < 2) {
    failures.push("All fixture URLs classified to the same credibilityTier - the classifier does not appear to be discriminating at all.");
  }

  return { ok: failures.length === 0, failures, warnings, counts: { totalChecks: checks.length, passed: checks.filter((c) => c.passed).length } };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Source Credibility Verification");
  console.log("=".repeat(60));
  console.log(`Fixture checks: ${result.counts.passed}/${result.counts.totalChecks} passed`);
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.forEach((f) => console.log(`  ✗ ${f}`));
  } else {
    console.log("\nAll checks passed.");
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifySourceCredibility();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:source-credibility:", error);
    process.exitCode = 1;
  });
}
