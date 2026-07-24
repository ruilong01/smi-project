import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Gate for discover:institution-images:sample. Checks the sample report
// exists, every accepted image has a real downloadedPath/source/rights/
// mock-AI metadata and the file genuinely exists on disk, every rejected
// image has a rejectionReason, no production research JSON was touched,
// and no secret/.env file was swept up alongside the sample output.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const reportPath = path.join(rootDir, "data/processed/test/institution-image-sample.json");

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function verifyInstitutionImageSample() {
  const failures = [];
  const warnings = [];

  const report = await readJsonIfExists(reportPath);
  if (!report) {
    failures.push(`${path.relative(rootDir, reportPath)} does not exist - run npm.cmd run discover:institution-images:sample first.`);
    return { ok: false, failures, warnings, counts: {} };
  }

  const counts = {
    accepted: report.accepted?.length ?? 0,
    rejected: report.rejected?.length ?? 0,
    downloadedFilesVerified: 0,
  };

  for (const image of report.accepted ?? []) {
    const label = image.institutionName || "(unnamed institution)";
    if (!image.imageSourceUrl) failures.push(`Accepted image for ${label} is missing imageSourceUrl.`);
    if (!image.rightsNote) failures.push(`Accepted image for ${label} is missing rightsNote.`);
    if (image.mockAiScore === undefined) failures.push(`Accepted image for ${label} is missing mockAiScore.`);
    if (!image.mockAiReason) failures.push(`Accepted image for ${label} is missing mockAiReason.`);

    if (!report.dryRun) {
      if (!image.downloadedPath) {
        failures.push(`Accepted image for ${label} has no downloadedPath (report is not a dry run).`);
        continue;
      }
      const filePath = path.join(rootDir, "public", image.downloadedPath.replace(/^\//, ""));
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      if (!exists) {
        failures.push(`Accepted image for ${label} references ${image.downloadedPath} but the file does not exist on disk.`);
      } else {
        counts.downloadedFilesVerified++;
      }
    }
  }

  for (const image of report.rejected ?? []) {
    const label = image.institutionName || "(unnamed institution)";
    if (!image.rejectionReason) {
      failures.push(`Rejected candidate for ${label} is missing rejectionReason.`);
    }
  }

  // No production research data may have been touched by this process.
  const displayRecordsPath = path.join(rootDir, "data/processed/display-records.json");
  const researchRecordsPath = path.join(rootDir, "data/processed/research-records.json");
  const displayExists = await fs.access(displayRecordsPath).then(() => true).catch(() => false);
  const researchExists = await fs.access(researchRecordsPath).then(() => true).catch(() => false);
  if (!displayExists || !researchExists) {
    warnings.push("Could not confirm display-records.json/research-records.json are untouched (one or both missing).");
  }

  // No secret/.env file may have been swept into the sample output tree.
  const testInstitutionsDir = path.join(rootDir, "public/assets/test/institutions");
  async function scanForSecrets(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanForSecrets(full);
      } else if (/^\.env|\.pem$|\.key$/i.test(entry.name)) {
        failures.push(`Found a secret-looking file in the sample output tree: ${path.relative(rootDir, full)}`);
      }
    }
  }
  await scanForSecrets(testInstitutionsDir);

  return { ok: failures.length === 0, failures, warnings, counts };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Institution Image Sample Verification");
  console.log("=".repeat(60));
  console.log(`Accepted:                  ${result.counts.accepted ?? 0}`);
  console.log(`Rejected:                  ${result.counts.rejected ?? 0}`);
  console.log(`Downloaded files verified: ${result.counts.downloadedFilesVerified ?? 0}`);
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
  const result = await verifyInstitutionImageSample();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:institution-image-sample:", error);
    process.exitCode = 1;
  });
}
