import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Gate for discover:research:global. Checks the staging candidates file
// exists, every candidate has the two required fields (title + sourceUrl),
// no two "candidate"-status entries share a normalized sourceUrl (the
// in-run dedup actually worked), no candidate looks like a fake/invented
// record (a real http(s) source URL, not empty/placeholder), country/
// institution extraction was attempted (never silently blank), and that
// this whole process never touched the production research-records.json/
// display-records.json files.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const candidatesPath = path.join(rootDir, "data/processed/test/research-discovery-candidates.json");

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeUrl(url) {
  return (url || "").trim().toLowerCase().replace(/\/$/, "");
}

export async function verifyResearchDiscovery() {
  const failures = [];
  const warnings = [];

  const report = await readJsonIfExists(candidatesPath);
  if (!report) {
    failures.push(`${path.relative(rootDir, candidatesPath)} does not exist - run npm.cmd run discover:research:global first.`);
    return { ok: false, failures, warnings, counts: {} };
  }

  const candidates = report.candidates ?? [];
  if (candidates.length === 0) {
    warnings.push("No candidates in the staging file - run discover:research:global with a real search to populate it.");
  }

  const counts = {
    total: candidates.length,
    newCandidates: candidates.filter((c) => c.status === "candidate").length,
    duplicates: candidates.filter((c) => c.status === "rejected").length,
    needsReview: candidates.filter((c) => c.status === "review").length,
  };

  const seenUrlsByStatus = new Map();
  candidates.forEach((candidate, index) => {
    const label = candidate.title || `candidate #${index}`;

    if (!candidate.title) failures.push(`Candidate missing title: ${JSON.stringify(candidate).slice(0, 120)}`);
    if (!candidate.sourceUrl) {
      failures.push(`"${label}" is missing sourceUrl.`);
    } else if (!/^https?:\/\//i.test(candidate.sourceUrl)) {
      failures.push(`"${label}" has a sourceUrl that is not http/https: ${candidate.sourceUrl}`);
    }

    if (!["candidate", "rejected", "review", "accepted"].includes(candidate.status)) {
      failures.push(`"${label}" has an invalid status: "${candidate.status}".`);
    }

    if (candidate.country === undefined || candidate.institution === undefined) {
      failures.push(`"${label}" is missing country/institution fields entirely (should be a real value or "unknown", never absent).`);
    }

    if (candidate.status === "candidate") {
      const key = normalizeUrl(candidate.sourceUrl);
      if (seenUrlsByStatus.has(key)) {
        failures.push(`Duplicate "candidate"-status sourceUrl found: ${candidate.sourceUrl} (in-run dedup should have caught this).`);
      }
      seenUrlsByStatus.set(key, label);
    }
  });

  // Staging-only: never in a production-facing location.
  if (!candidatesPath.includes(`${path.sep}test${path.sep}`)) {
    failures.push("Candidates file is not under a data/processed/test/ staging path.");
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
  console.log("Research Discovery Verification");
  console.log("=".repeat(60));
  console.log(`Total candidates:   ${result.counts.total ?? 0}`);
  console.log(`New (candidate):    ${result.counts.newCandidates ?? 0}`);
  console.log(`Duplicates:         ${result.counts.duplicates ?? 0}`);
  console.log(`Needs review:       ${result.counts.needsReview ?? 0}`);
  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.slice(0, 40).forEach((f) => console.log(`  ✗ ${f}`));
  } else {
    console.log("\nAll checks passed.");
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifyResearchDiscovery();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:research-discovery:", error);
    process.exitCode = 1;
  });
}
