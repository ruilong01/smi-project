import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFParse } from "pdf-parse";
import { resolveOrDerivePolicy } from "../processing/pdfAccessPolicy.mjs";

// Page-aware PDF text extraction for the in-app PDF reader (see
// docs/IN_APP_PDF_READER.md). Runs entirely locally against PDFs already
// downloaded by discoverOpenAccessPdfs.mjs - no network call, no AI. Only
// extracts text for entries the access policy already approved for in-app
// serving (serveInApp: true); a PDF the policy withholds gets no text
// extracted either, since there'd be nowhere to show it. One bad/corrupt
// PDF never stops the run (CLAUDE.md rule 6) - it's recorded as
// textExtractionStatus: "failed" and the run continues.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const manifestPath = path.join(rootDir, "data/server/runtime/pdf-download-manifest.json");
const textOutputDir = path.join(rootDir, "data/server/pdf-text");

const DEFAULT_LIMIT = 10;
const MAX_PAGES_TO_EXTRACT = 300; // safety cap - a legitimate paper is never this long

function nowIso() {
  return new Date().toISOString();
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function slugFromPaperId(paperId) {
  return (paperId || "unknown")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

async function extractOne(entry, { dryRun, log }) {
  const absolutePath = path.resolve(rootDir, entry.downloadedPath);
  const buffer = await fs.readFile(absolutePath);

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const truncated = result.total > MAX_PAGES_TO_EXTRACT;
    const pages = result.pages.slice(0, MAX_PAGES_TO_EXTRACT).map((page) => ({
      page: page.num,
      text: page.text,
      charCount: page.text.length,
    }));

    const output = {
      paperId: entry.paperId,
      title: entry.title,
      sourceName: entry.sourceName,
      extractedAt: nowIso(),
      pageCount: result.total,
      pagesExtracted: pages.length,
      truncated,
      pages,
      textExtractionStatus: "success",
    };

    const relativeTextPath = path.join("data/server/pdf-text", `${slugFromPaperId(entry.paperId)}.json`);
    if (!dryRun) {
      await fs.mkdir(textOutputDir, { recursive: true });
      await fs.writeFile(path.join(rootDir, relativeTextPath), `${JSON.stringify(output, null, 2)}\n`);
    }
    log(`  Extracted: ${entry.title} - ${output.pageCount} page(s)${truncated ? ` (truncated to ${MAX_PAGES_TO_EXTRACT})` : ""}`);
    return { status: "success", pdfTextPath: relativeTextPath.replace(/\\/g, "/"), pageCount: result.total };
  } finally {
    await parser.destroy();
  }
}

export async function extractPdfText({ limit = DEFAULT_LIMIT, paperId, force = false, dryRun = false, log = console.log } = {}) {
  const manifest = await readJsonIfExists(manifestPath);
  const downloads = manifest?.downloads ?? [];
  if (downloads.length === 0) {
    log("  No downloaded PDFs in the manifest - run discover:oa-pdfs --download first.");
    return { processed: 0, succeeded: 0, failed: 0, skipped: 0, results: [] };
  }

  const targets = downloads.filter((entry) => {
    if (paperId && entry.paperId !== paperId) return false;
    const policy = resolveOrDerivePolicy(entry);
    if (!policy.serveInApp) return false;
    if (!force && entry.textExtractionStatus === "success") return false;
    return true;
  });

  const results = [];
  let succeeded = 0;
  let failed = 0;

  for (const entry of targets.slice(0, limit)) {
    try {
      const outcome = await extractOne(entry, { dryRun, log });
      entry.textExtractionStatus = outcome.status;
      entry.pdfTextPath = outcome.pdfTextPath;
      succeeded++;
      results.push({ paperId: entry.paperId, title: entry.title, status: outcome.status, pageCount: outcome.pageCount });
    } catch (error) {
      entry.textExtractionStatus = "failed";
      entry.pdfTextPath = null;
      failed++;
      log(`  FAILED: ${entry.title}: ${error.message}`);
      results.push({ paperId: entry.paperId, title: entry.title, status: "failed", error: error.message });
    }
  }

  const skipped = downloads.length - targets.length;

  if (!dryRun && (succeeded > 0 || failed > 0)) {
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return { processed: results.length, succeeded, failed, skipped, results };
}

function parseArgs(argv) {
  const args = { limit: DEFAULT_LIMIT, force: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--force") args.force = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--paper-id") args.paperId = argv[++i];
    else if (arg.startsWith("--paper-id=")) args.paperId = arg.slice("--paper-id=".length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await extractPdfText(args);

  console.log("\n" + "=".repeat(60));
  console.log("PDF Text Extraction Summary");
  console.log("=".repeat(60));
  console.log(`Mode:        ${args.dryRun ? "DRY RUN (no writes)" : "live"}`);
  console.log(`Processed:   ${result.processed}`);
  console.log(`  Succeeded: ${result.succeeded}`);
  console.log(`  Failed:    ${result.failed}`);
  console.log(`Skipped:     ${result.skipped} (already extracted, policy withholds serving, or paperId filter)`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during extract:pdf-text:", error);
    process.exitCode = 1;
  });
}
