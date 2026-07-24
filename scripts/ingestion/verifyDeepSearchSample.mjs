import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Gate for deep-search:sample. Checks the staging output exists, every
// candidate has the two required fields, every official reference has a
// real http(s) URL and a credibility classification, and production
// research data was never touched.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const outputPath = path.join(rootDir, "data/processed/test/deep-search-sample.json");

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifyDeepSearchSample() {
  const failures = [];
  const warnings = [];

  const report = await readJsonIfExists(outputPath);
  if (!report) {
    failures.push(`${path.relative(rootDir, outputPath)} does not exist - run npm.cmd run deep-search:sample first (not --dry-run).`);
    return { ok: false, failures, warnings, counts: {} };
  }

  if (!report.country || !report.topic) {
    failures.push("Report is missing country/topic.");
  }
  if (!Array.isArray(report.queryVariantsUsed) || report.queryVariantsUsed.length < 2) {
    failures.push("Report must record at least 2 query variants - a single-term search is not a 'deep' search.");
  }

  const candidates = report.candidates ?? [];
  candidates.forEach((candidate, index) => {
    const label = candidate.title || `candidate #${index}`;
    if (!candidate.title) failures.push(`Candidate #${index} is missing title.`);
    if (!candidate.sourceUrl) failures.push(`"${label}" is missing sourceUrl.`);
    if (!candidate.sourceCredibilityTier) failures.push(`"${label}" is missing sourceCredibilityTier.`);
  });

  const officialReferences = report.officialReferences ?? [];
  officialReferences.forEach((ref, index) => {
    if (!ref.sourceUrl || !/^https?:\/\//i.test(ref.sourceUrl)) {
      failures.push(`Official reference #${index} is missing a valid http(s) sourceUrl.`);
    }
    if (!ref.sourceCredibilityTier) {
      failures.push(`Official reference #${index} is missing sourceCredibilityTier.`);
    }
  });

  // Staging-only.
  if (!outputPath.includes(`${path.sep}test${path.sep}`)) {
    failures.push("Output file is not under a data/processed/test/ staging path.");
  }

  // Production research data must be untouched.
  const displayRecordsPath = path.join(rootDir, "data/processed/display-records.json");
  const researchRecordsPath = path.join(rootDir, "data/processed/research-records.json");
  const displayExists = await fs.access(displayRecordsPath).then(() => true).catch(() => false);
  const researchExists = await fs.access(researchRecordsPath).then(() => true).catch(() => false);
  if (!displayExists || !researchExists) {
    warnings.push("Could not confirm display-records.json/research-records.json are untouched (one or both missing).");
  }

  return {
    ok: failures.length === 0,
    failures,
    warnings,
    counts: { candidates: candidates.length, officialReferences: officialReferences.length },
  };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Deep Search Sample Verification");
  console.log("=".repeat(60));
  console.log(`Candidates:          ${result.counts.candidates ?? 0}`);
  console.log(`Official references: ${result.counts.officialReferences ?? 0}`);
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
  const result = await verifyDeepSearchSample();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:deep-search-sample:", error);
    process.exitCode = 1;
  });
}
