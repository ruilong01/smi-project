import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Gate for discover:oa-pdfs (see docs/OPEN_ACCESS_PDF_INGESTION.md). Checks
// that production research data was never touched, server-side PDF/staging/
// runtime storage stays out of git, staging candidates exist when expected,
// every downloaded PDF has complete provenance metadata and really exists on
// disk, rejected items always carry a reason, blocked sources
// (ResearchGate/Academia.edu/Scribd/Sci-Hub/paywalled) are never accepted,
// no oversized PDF was kept, and no sha256 was accepted/downloaded twice.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const stagingPath = path.join(rootDir, "data/server/staging/oa-pdf-candidates.json");
const manifestPath = path.join(rootDir, "data/server/runtime/pdf-download-manifest.json");
const scanStatusPath = path.join(rootDir, "data/server/runtime/oa-pdf-scan-status.json");
const displayRecordsPath = path.join(rootDir, "data/processed/display-records.json");
const researchRecordsPath = path.join(rootDir, "data/processed/research-records.json");
const gitignorePath = path.join(rootDir, ".gitignore");

const MAX_PDF_BYTES = 25 * 1024 * 1024;
const BLOCKED_HOST_PATTERN = /researchgate\.net|academia\.edu|scribd\.com|sci-hub\./i;

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function run(command) {
  try {
    return execSync(command, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return { error };
  }
}

export async function verifyOpenAccessPdfIngestion() {
  const failures = [];
  const warnings = [];
  const counts = {};

  // 1. Production research JSON never modified by this pipeline.
  const statusResult = run("git status --porcelain -- data/processed/research-records.json data/processed/display-records.json");
  if (statusResult.error) {
    warnings.push(`Could not check git status for production files: ${statusResult.error.message.split("\n")[0]}`);
  } else if (statusResult.trim()) {
    failures.push(`Production research data has uncommitted changes - discover:oa-pdfs must never touch these:\n${statusResult.trim()}`);
  }
  const displayExists = await fs.access(displayRecordsPath).then(() => true).catch(() => false);
  const researchExists = await fs.access(researchRecordsPath).then(() => true).catch(() => false);
  if (!displayExists || !researchExists) {
    warnings.push("Could not confirm production research/display files are present to check against.");
  }

  // 2. Server-side storage stays out of git (gitignored, nothing staged).
  const gitignore = await fs.readFile(gitignorePath, "utf8").catch(() => "");
  if (!/^data\/server\/$/m.test(gitignore)) {
    failures.push(".gitignore does not contain a `data/server/` entry - PDFs/staging/runtime output could be committed by accident.");
  }
  const trackedServerFiles = run('git ls-files -- "data/server"');
  if (!trackedServerFiles.error && trackedServerFiles.trim()) {
    failures.push(`data/server/** files are tracked by git (must never be committed):\n${trackedServerFiles.trim()}`);
  }
  const stagedServerFiles = run("git diff --cached --name-only -- data/server");
  if (!stagedServerFiles.error && stagedServerFiles.trim()) {
    failures.push(`data/server/** files are currently staged for commit:\n${stagedServerFiles.trim()}`);
  }

  // 3. Candidate metadata staging file.
  const staging = await readJsonIfExists(stagingPath);
  if (!staging) {
    warnings.push(`${path.relative(rootDir, stagingPath)} does not exist - run npm run discover:oa-pdfs -- --write-staging first to check candidate metadata.`);
  } else {
    counts.candidatesStaged = staging.candidates?.length ?? 0;
    (staging.candidates ?? []).forEach((candidate, index) => {
      const label = candidate.title || `candidate #${index}`;

      // 5. Rejected items always carry a reason.
      if (candidate.status === "rejected" && !candidate.rejectionReason) {
        failures.push(`"${label}" is rejected but has no rejectionReason.`);
      }

      // 6. Blocked sources are never accepted/downloaded, regardless of any OA claim.
      const hostCandidates = [candidate.sourceUrl, candidate.pdfUrl].filter(Boolean);
      const matchedBlocked = hostCandidates.find((url) => BLOCKED_HOST_PATTERN.test(url));
      if (matchedBlocked && candidate.status !== "rejected") {
        failures.push(`"${label}" uses a blocked source (${matchedBlocked}) but status is "${candidate.status}", not "rejected".`);
      }

      if ((candidate.status === "candidate" || candidate.status === "downloaded") && !candidate.oaEvidence) {
        failures.push(`"${label}" is ${candidate.status} but has no oaEvidence.`);
      }
    });
  }

  // 4. Every downloaded PDF has complete provenance metadata and really exists.
  const manifest = await readJsonIfExists(manifestPath);
  const downloads = manifest?.downloads ?? [];
  counts.downloadsInManifest = downloads.length;

  for (const [index, entry] of downloads.entries()) {
    const label = entry.title || `download #${index}`;
    if (!entry.sourceUrl && !entry.pdfUrl) failures.push(`"${label}" manifest entry is missing sourceUrl/pdfUrl.`);
    if (!entry.sha256) failures.push(`"${label}" manifest entry is missing sha256.`);
    if (!entry.fileSizeBytes) failures.push(`"${label}" manifest entry is missing fileSizeBytes.`);
    if (!entry.downloadedPath) {
      failures.push(`"${label}" manifest entry is missing downloadedPath.`);
      continue;
    }
    const absolutePath = path.join(rootDir, entry.downloadedPath);
    const fileExists = await fs.access(absolutePath).then(() => true).catch(() => false);
    if (!fileExists) {
      failures.push(`"${label}" downloadedPath (${entry.downloadedPath}) does not exist on disk.`);
      continue;
    }
    const stat = await fs.stat(absolutePath);
    // 7. No PDF larger than the max size.
    if (stat.size > MAX_PDF_BYTES) {
      failures.push(`"${label}" file is ${stat.size} bytes, exceeding the ${MAX_PDF_BYTES}-byte max.`);
    }
    if (entry.fileSizeBytes !== stat.size) {
      failures.push(`"${label}" manifest fileSizeBytes (${entry.fileSizeBytes}) does not match actual file size (${stat.size}).`);
    }
  }

  // Cross-check every downloaded candidate in staging also has isOpenAccess=true + oaEvidence.
  (staging?.candidates ?? [])
    .filter((c) => c.status === "downloaded")
    .forEach((candidate) => {
      const label = candidate.title || "downloaded candidate";
      if (!candidate.isOpenAccess) failures.push(`"${label}" is downloaded but isOpenAccess is not true.`);
      if (!candidate.sha256) failures.push(`"${label}" is downloaded but has no sha256 recorded in staging.`);
      if (!candidate.fileSizeBytes) failures.push(`"${label}" is downloaded but has no fileSizeBytes recorded in staging.`);
    });

  // 8. No duplicate sha256 accepted/downloaded twice.
  const shaCounts = new Map();
  downloads.forEach((entry) => {
    if (!entry.sha256) return;
    shaCounts.set(entry.sha256, (shaCounts.get(entry.sha256) ?? 0) + 1);
  });
  for (const [sha256, count] of shaCounts.entries()) {
    if (count > 1) failures.push(`sha256 ${sha256} appears ${count} times in the download manifest - a duplicate PDF was accepted twice.`);
  }

  // Scan status sanity (mirrors verifyDailyScanSafety's convention).
  const scanStatus = await readJsonIfExists(scanStatusPath);
  if (scanStatus) {
    counts.lastScanDownloadedCount = scanStatus.downloadedCount ?? 0;
    if (scanStatus.schedulerInstalled !== false) {
      failures.push('oa-pdf-scan-status.json does not have schedulerInstalled: false - no scheduler should ever be installed by this pipeline yet.');
    }
  }

  return { ok: failures.length === 0, failures, warnings, counts };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Open-Access PDF Ingestion Verification");
  console.log("=".repeat(60));
  console.log(`Candidates staged:      ${result.counts.candidatesStaged ?? "(no staging file)"}`);
  console.log(`Downloads in manifest:  ${result.counts.downloadsInManifest ?? 0}`);
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
  const result = await verifyOpenAccessPdfIngestion();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:oa-pdf-ingestion:", error);
    process.exitCode = 1;
  });
}
