import fs from "node:fs/promises";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { evaluatePdfAccessPolicy, resolveOrDerivePolicy } from "../processing/pdfAccessPolicy.mjs";
import { findLinkedPdfCandidate } from "../processing/pdfRecordLinker.mjs";

// Gate for the in-app PDF reader (see docs/IN_APP_PDF_READER.md). Combines
// three kinds of checks: (1) fixture-based unit tests of the pure policy/
// linker functions - the same adversarial-fixture pattern already used by
// verifySourceCredibility.mjs, (2) static source checks on server.mjs's
// new PDF routes - the same "prove the safety gate exists in the shipped
// code" pattern already used by verifyDailyScanSafety.mjs, since actually
// spinning up the HTTP server isn't this codebase's convention, and (3)
// checks against whatever real state (manifest, extracted text files)
// happens to be on disk right now.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const manifestPath = path.join(rootDir, "data/server/runtime/pdf-download-manifest.json");
const textDir = path.join(rootDir, "data/server/pdf-text");
const serverSourcePath = path.join(rootDir, "server/server.mjs");
const gitignorePath = path.join(rootDir, ".gitignore");

function run(command) {
  try {
    return execSync(command, { cwd: rootDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return { error };
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

// Strips comments before pattern-matching against server.mjs's source, so
// this verifier's own checks can't false-positive against an explanatory
// comment mentioning the same words (the recurring bug class fixed earlier
// in verifyDailyScanSafety.mjs/verifyNoBlueFlash.mjs).
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

const POLICY_FIXTURE_CASES = [
  {
    label: "arXiv perpetual license, confirmed OA",
    input: { license: "arXiv.org perpetual, non-exclusive license", isOpenAccess: true, oaEvidence: "Official arXiv PDF" },
    expected: { serveInApp: true, allowUserDownload: true },
  },
  {
    label: "CC-BY, confirmed OA",
    input: { license: "cc-by", isOpenAccess: true, oaEvidence: "Unpaywall best_oa_location" },
    expected: { serveInApp: true, allowUserDownload: true },
  },
  {
    label: "CC-BY-NC, confirmed OA - viewable, download withheld",
    input: { license: "cc-by-nc", isOpenAccess: true, oaEvidence: "Europe PMC isOpenAccess=Y" },
    expected: { serveInApp: true, allowUserDownload: false },
  },
  {
    label: "All rights reserved - never served despite OA claim",
    input: { license: "All rights reserved", isOpenAccess: true, oaEvidence: "some claimed evidence" },
    expected: { serveInApp: false, allowUserDownload: false },
  },
  {
    label: "No license text, confirmed OA - conservative view-only",
    input: { license: null, isOpenAccess: true, oaEvidence: "CORE repository downloadUrl" },
    expected: { serveInApp: true, allowUserDownload: false },
  },
  {
    label: "isOpenAccess false - never served regardless of license",
    input: { license: "cc-by", isOpenAccess: false, oaEvidence: "" },
    expected: { serveInApp: false, allowUserDownload: false },
  },
  {
    label: "No oaEvidence at all - never served",
    input: { license: "cc-by", isOpenAccess: true, oaEvidence: "" },
    expected: { serveInApp: false, allowUserDownload: false },
  },
];

const DERIVE_FIXTURE_CASES = [
  {
    label: "Preserved policy on the entry always wins over re-deriving",
    entry: { serveInApp: false, allowUserDownload: false, policyReason: "manually withheld", license: "cc-by", isOpenAccess: true, oaEvidence: "x" },
    expected: { serveInApp: false, allowUserDownload: false },
  },
  {
    label: "Legacy entry (no policy fields at all) derives conservative view-only",
    entry: { paperId: "arxiv-legacy-example", title: "Legacy entry", sourceUrl: "https://arxiv.org/abs/1234.5678" },
    expected: { serveInApp: true, allowUserDownload: false },
  },
  {
    label: "Legacy entry explicitly marked isOpenAccess:false derives never-served",
    entry: { paperId: "legacy-2", isOpenAccess: false },
    expected: { serveInApp: false, allowUserDownload: false },
  },
];

const LINKER_FIXTURE_CASES = [
  {
    label: "DOI match, ignoring https://doi.org/ prefix and case",
    record: { doi: "10.1016/J.TRE.2023.103098", sourceUrl: "https://cordis.europa.eu/project/id/999" },
    candidates: [{ paperId: "a", doi: "https://doi.org/10.1016/j.tre.2023.103098", sourceUrl: "https://unrelated.example/x" }],
    expectMatchPaperId: "a",
  },
  {
    label: "sourceUrl match, ignoring protocol/www/trailing slash",
    record: { doi: null, sourceUrl: "https://www.mpa.gov.sg/maritime-singapore/innovation-and-r-d/" },
    candidates: [{ paperId: "b", doi: null, sourceUrl: "http://mpa.gov.sg/maritime-singapore/innovation-and-r-d" }],
    expectMatchPaperId: "b",
  },
  {
    label: "sourceUrls[] array match (via the secondary URL, not the primary sourceUrl)",
    record: {
      doi: null,
      sourceUrl: "https://cordis.europa.eu/project/id/1",
      sourceUrls: ["https://cordis.europa.eu/project/id/1", "https://cordis.europa.eu/project/id/1/results"],
    },
    candidates: [{ paperId: "c", doi: null, sourceUrl: "https://cordis.europa.eu/project/id/1/results" }],
    expectMatchPaperId: "c",
  },
  {
    label: "No overlap at all - correctly returns null",
    record: { doi: "10.1/unrelated", sourceUrl: "https://example.org/unrelated" },
    candidates: [{ paperId: "d", doi: "10.2/other", sourceUrl: "https://example.org/other" }],
    expectMatchPaperId: null,
  },
];

export async function verifyPdfViewerPipeline() {
  const failures = [];
  const warnings = [];
  const counts = {};

  // --- 1. Policy fixture tests ---
  POLICY_FIXTURE_CASES.forEach(({ label, input, expected }) => {
    const result = evaluatePdfAccessPolicy(input);
    if (result.serveInApp !== expected.serveInApp || result.allowUserDownload !== expected.allowUserDownload) {
      failures.push(
        `Policy fixture "${label}": expected serveInApp=${expected.serveInApp}/allowUserDownload=${expected.allowUserDownload}, got serveInApp=${result.serveInApp}/allowUserDownload=${result.allowUserDownload}.`
      );
    }
  });

  // --- 2. Derive/preserve fixture tests ---
  DERIVE_FIXTURE_CASES.forEach(({ label, entry, expected }) => {
    const result = resolveOrDerivePolicy(entry);
    if (result.serveInApp !== expected.serveInApp || result.allowUserDownload !== expected.allowUserDownload) {
      failures.push(
        `Derive fixture "${label}": expected serveInApp=${expected.serveInApp}/allowUserDownload=${expected.allowUserDownload}, got serveInApp=${result.serveInApp}/allowUserDownload=${result.allowUserDownload}.`
      );
    }
  });

  // --- 3. Linker fixture tests ---
  LINKER_FIXTURE_CASES.forEach(({ label, record, candidates, expectMatchPaperId }) => {
    const match = findLinkedPdfCandidate(record, candidates);
    const actualPaperId = match?.paperId ?? null;
    if (actualPaperId !== expectMatchPaperId) {
      failures.push(`Linker fixture "${label}": expected match paperId=${expectMatchPaperId}, got ${actualPaperId}.`);
    }
  });

  // --- 4. .gitignore / git-tracking checks ---
  const gitignore = await fs.readFile(gitignorePath, "utf8").catch(() => "");
  if (!/^data\/server\/$/m.test(gitignore)) {
    failures.push(".gitignore does not contain a `data/server/` entry - PDFs/extracted text/manifest could be committed by accident.");
  }
  const trackedServerFiles = run('git ls-files -- "data/server"');
  if (!trackedServerFiles.error && trackedServerFiles.trim()) {
    failures.push(`data/server/** files are tracked by git (must never be committed):\n${trackedServerFiles.trim()}`);
  }
  const stagedServerFiles = run("git diff --cached --name-only -- data/server");
  if (!stagedServerFiles.error && stagedServerFiles.trim()) {
    failures.push(`data/server/** files are currently staged for commit:\n${stagedServerFiles.trim()}`);
  }

  // --- 5. Real manifest + extracted-text state checks ---
  const manifest = await readJsonIfExists(manifestPath);
  const downloads = manifest?.downloads ?? [];
  counts.manifestEntries = downloads.length;

  let extractedCount = 0;
  for (const entry of downloads) {
    if (entry.textExtractionStatus !== "success") continue;
    extractedCount++;
    if (!entry.pdfTextPath) {
      failures.push(`"${entry.title}" has textExtractionStatus=success but no pdfTextPath recorded.`);
      continue;
    }
    const textFile = await readJsonIfExists(path.join(rootDir, entry.pdfTextPath));
    if (!textFile) {
      failures.push(`"${entry.title}"'s pdfTextPath (${entry.pdfTextPath}) does not exist or is not valid JSON.`);
      continue;
    }
    if (!Array.isArray(textFile.pages) || textFile.pages.length === 0) {
      failures.push(`"${entry.title}"'s extracted text file has no pages[].`);
    } else {
      textFile.pages.forEach((page, index) => {
        if (typeof page.page !== "number" || typeof page.text !== "string") {
          failures.push(`"${entry.title}"'s extracted text page #${index} is missing a numeric page/string text field.`);
        }
      });
    }
  }
  counts.textExtractedEntries = extractedCount;

  const textDirExists = await fs.access(textDir).then(() => true).catch(() => false);
  if (!textDirExists) {
    warnings.push(`${path.relative(rootDir, textDir)} does not exist yet - run npm run extract:pdf-text first.`);
  }

  if (downloads.length === 0) {
    warnings.push("No downloaded PDFs in the manifest yet - run npm run discover:oa-pdfs -- --download first to exercise the full pipeline.");
  }

  // --- 6. Static safety checks on server.mjs's new routes ---
  const serverSource = await fs.readFile(serverSourcePath, "utf8").catch(() => "");
  const serverCode = stripComments(serverSource);

  if (!/resource === "research-records" && identifier && action === "pdf"/.test(serverCode)) {
    failures.push("server.mjs does not appear to define the GET /api/research-records/:recordId/pdf route.");
  }
  if (!/serveInApp/.test(serverCode)) {
    failures.push("server.mjs's PDF route does not reference serveInApp - the access-policy gate may be missing.");
  }
  if (!/PDF_STORAGE_ROOT/.test(serverCode) || !/startsWith\(PDF_STORAGE_ROOT/.test(serverCode)) {
    failures.push("server.mjs does not verify the resolved PDF path stays under PDF_STORAGE_ROOT - a manifest/path-traversal safety gate may be missing.");
  }
  if (!/existsSync\(absolutePath\)/.test(serverCode)) {
    failures.push("server.mjs does not check the PDF file actually exists on disk before serving it.");
  }
  // Never let the client-supplied recordId/identifier be used to directly
  // build a filesystem path (path.join(..., identifier) or similar) -
  // recordId must only ever be used as a lookup key.
  if (/path\.join\([^)]*\b(identifier|recordId)\b/.test(serverCode) || /path\.resolve\([^)]*\b(identifier|recordId)\b/.test(serverCode)) {
    failures.push("server.mjs appears to build a filesystem path directly from the client-supplied recordId/identifier - this must only ever be a lookup key.");
  }

  return { ok: failures.length === 0, failures, warnings, counts };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("In-App PDF Reader Pipeline Verification");
  console.log("=".repeat(60));
  console.log(`Manifest entries:          ${result.counts.manifestEntries ?? 0}`);
  console.log(`Text-extracted entries:    ${result.counts.textExtractedEntries ?? 0}`);
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
  const result = await verifyPdfViewerPipeline();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:pdf-viewer-pipeline:", error);
    process.exitCode = 1;
  });
}
