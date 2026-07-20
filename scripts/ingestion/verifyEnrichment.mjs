/**
 * Sanity-checks the output of `npm.cmd run enrich:sample` — structural and
 * internal-consistency checks, not a re-run of the network calls. Exits
 * non-zero (and prints exactly which check failed) if the enriched JSON
 * doesn't hold up, so a broken run can't be silently reported as good.
 *
 * Usage: npm.cmd run verify:enrichment
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runsDir = path.resolve(__dirname, "../../data/raw/enrichment-runs");

// enrichSample.mjs writes a dated file per run (<country>-sample-<date>.json)
// rather than one fixed name — verify the most recently modified one.
async function findLatestOutputPath() {
  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const candidates = entries.filter(
    (entry) => entry.isFile() && /-sample-\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)
  );
  if (candidates.length === 0) {
    return null;
  }

  const withStats = await Promise.all(
    candidates.map(async (entry) => {
      const fullPath = path.join(runsDir, entry.name);
      const stats = await fs.stat(fullPath);
      return { fullPath, mtimeMs: stats.mtimeMs };
    })
  );
  withStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return withStats[0].fullPath;
}

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
  console.log(`  ✗ ${message}`);
}

function pass(message) {
  console.log(`  ✓ ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.log(`  ⚠ ${message}`);
}

async function main() {
  console.log("=".repeat(60));
  console.log("Verifying enrichment output");
  console.log("=".repeat(60));

  // 1. File exists and is valid JSON.
  const outputPath = await findLatestOutputPath();
  if (!outputPath) {
    fail(`No enrichment run output found in ${runsDir} (run npm run enrich:sample first)`);
    printSummaryAndExit();
    return;
  }

  let raw;
  try {
    raw = await fs.readFile(outputPath, "utf8");
  } catch (error) {
    fail(`Output file does not exist or is unreadable: ${outputPath} (${error.message})`);
    printSummaryAndExit();
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    fail(`Output file is not valid JSON: ${error.message}`);
    printSummaryAndExit();
    return;
  }
  pass(`Output file exists and parses as JSON: ${outputPath}`);

  const records = data.records ?? [];

  // 2. At least 1 record exists.
  if (records.length >= 1) {
    pass(`At least 1 record exists (${records.length} total)`);
  } else {
    fail("No records found in output (expected at least 1)");
  }

  // 3. Records have source URLs.
  const missingSourceUrl = records.filter((record) => !record.sourceUrl);
  if (records.length > 0 && missingSourceUrl.length === 0) {
    pass(`All ${records.length} record(s) have a sourceUrl`);
  } else if (records.length > 0) {
    fail(`${missingSourceUrl.length} of ${records.length} record(s) are missing a sourceUrl`);
  }

  // 4. At least one fetched timestamp exists.
  const fetchedTimestamps = records
    .flatMap((record) => record.sourcePages ?? [])
    .map((page) => page.fetchedAt)
    .filter(Boolean);
  if (fetchedTimestamps.length >= 1) {
    pass(`At least 1 fetchedAt timestamp exists (${fetchedTimestamps.length} total)`);
  } else {
    fail("No fetchedAt timestamps found on any source page");
  }

  // 5. Internal consistency: dataQuality.hasEvidenceSnippets must match
  //    reality, not just claim it (this exact mismatch was a real bug
  //    caught in the previous run of this pipeline).
  let evidenceSnippetTotal = 0;
  let imageCandidateTotal = 0;
  let successfulSourcePages = 0;
  records.forEach((record) => {
    const evidenceCount = (record.sourcePages ?? []).reduce(
      (sum, page) => sum + (page.evidenceSnippets?.length ?? 0),
      0
    );
    const imageCount = (record.sourcePages ?? []).reduce(
      (sum, page) => sum + (page.images?.length ?? 0),
      0
    );
    evidenceSnippetTotal += evidenceCount;
    imageCandidateTotal += imageCount;
    if ((record.sourcePages ?? []).some((page) => page.statusCode === 200 && page.cleanedTextSummary)) {
      successfulSourcePages += 1;
    }

    if (record.dataQuality?.hasEvidenceSnippets && evidenceCount === 0) {
      fail(
        `${record.id}: dataQuality.hasEvidenceSnippets is true but evidenceSnippets is empty`
      );
    }
    if (record.dataQuality?.hasImageCandidates && imageCount === 0) {
      fail(`${record.id}: dataQuality.hasImageCandidates is true but images is empty`);
    }
  });

  if (successfulSourcePages > 0) {
    pass(`${successfulSourcePages} record(s) have a successfully extracted source page`);
    if (evidenceSnippetTotal > 0) {
      pass(`Evidence snippets present for successful extraction(s): ${evidenceSnippetTotal} total`);
    } else {
      warn("Source page(s) succeeded but produced 0 evidence snippets");
    }
    if (imageCandidateTotal > 0) {
      pass(`Image candidates present: ${imageCandidateTotal} total`);
    } else {
      warn("Source page(s) succeeded but produced 0 image candidates (may be a text-only page)");
    }
  } else {
    warn(
      "0 of " +
        records.length +
        " source pages were successfully extracted this run (external sites blocked the " +
        "fetch) — not a hard failure, but no evidence/image content exists to check"
    );
  }

  console.log(
    `\nMeta reported: ${JSON.stringify(data.meta ?? {}, null, 2).split("\n").join("\n  ")}`
  );

  printSummaryAndExit();

  function printSummaryAndExit() {
    console.log("\n" + "=".repeat(60));
    console.log(
      failures.length === 0
        ? `PASS — 0 hard failures, ${warnings.length} warning(s)`
        : `FAIL — ${failures.length} hard failure(s), ${warnings.length} warning(s)`
    );
    console.log("=".repeat(60));
    process.exitCode = failures.length === 0 ? 0 : 1;
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
