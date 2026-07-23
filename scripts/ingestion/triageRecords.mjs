import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeResearchRecord } from "../processing/normalizeResearchRecord.mjs";

// Splits a set of already-normalized records into the three files the rest
// of the app is allowed to read:
//
//   display-records.json          - displayEligible records only. This is
//                                    the ONLY file the frontend reads.
//   pending-image-enrichment.json - real, source-linked records with no
//                                    image candidate yet. Admin/debug only.
//   rejected-records.json         - mock/demo/unverified records. Never
//                                    shown anywhere in the app.
//   display-eligibility-report.json - every record's eligibility verdict
//                                    and reasons, for auditing why any
//                                    given record is or isn't shown.
//
// partitionRecords() is a pure function (no file I/O) so
// scripts/ingestion/processRecords.mjs can call it directly and write all
// four files as part of its own single atomic temp-write/validate/backup/
// swap - triage is not a separate unsafe write step bolted on afterwards.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const processedDir = path.join(rootDir, "data/processed");

export function partitionRecords(records, { nowIso = new Date().toISOString() } = {}) {
  const normalized = records.map((record) => normalizeResearchRecord(record, { nowIso }));

  const displayRecords = normalized.filter((r) => r.displayEligible);
  const pendingRecords = normalized.filter((r) => r.processingStatus === "pending_image_enrichment");
  const rejectedRecords = normalized.filter((r) => r.processingStatus === "rejected");

  const reportEntries = normalized.map((r) => ({
    recordId: r.recordId,
    title: r.title,
    displayEligible: r.displayEligible,
    displayEligibilityReasons: r.displayEligibilityReasons,
    processingStatus: r.processingStatus,
    verificationStatus: r.verificationStatus,
  }));

  return {
    normalized,
    displayRecords,
    pendingRecords,
    rejectedRecords,
    report: {
      generatedAt: nowIso,
      totalRecords: normalized.length,
      displayEligibleCount: displayRecords.length,
      hiddenCount: normalized.length - displayRecords.length,
      hiddenNoImage: pendingRecords.length,
      hiddenRejected: rejectedRecords.length,
      entries: reportEntries,
    },
  };
}

export function buildTriageOutputFiles(records, { nowIso = new Date().toISOString() } = {}) {
  const { displayRecords, pendingRecords, rejectedRecords, report } = partitionRecords(records, { nowIso });

  return {
    "display-records.json": {
      generatedAt: nowIso,
      note:
        "Only source-proven records with related image candidates are displayed. Other real records are kept pending enrichment.",
      recordCount: displayRecords.length,
      records: displayRecords,
    },
    "pending-image-enrichment.json": {
      generatedAt: nowIso,
      recordCount: pendingRecords.length,
      records: pendingRecords,
    },
    "rejected-records.json": {
      generatedAt: nowIso,
      recordCount: rejectedRecords.length,
      records: rejectedRecords,
    },
    "display-eligibility-report.json": report,
  };
}

export async function triageRecords({ processedDir: dir = processedDir, nowIso = new Date().toISOString() } = {}) {
  const researchRecordsPath = path.join(dir, "research-records.json");
  const raw = JSON.parse(await fs.readFile(researchRecordsPath, "utf8"));

  const files = buildTriageOutputFiles(raw.records ?? [], { nowIso });

  await fs.mkdir(dir, { recursive: true });
  for (const [fileName, content] of Object.entries(files)) {
    await fs.writeFile(path.join(dir, fileName), `${JSON.stringify(content, null, 2)}\n`);
  }

  return {
    totalRecords: files["display-eligibility-report.json"].totalRecords,
    displayEligibleCount: files["display-records.json"].recordCount,
    pendingImageEnrichmentCount: files["pending-image-enrichment.json"].recordCount,
    rejectedCount: files["rejected-records.json"].recordCount,
  };
}

async function main() {
  const result = await triageRecords();
  console.log("\n" + "=".repeat(60));
  console.log("Record Triage Summary");
  console.log("=".repeat(60));
  console.log(`Total records:                 ${result.totalRecords}`);
  console.log(`Display eligible:              ${result.displayEligibleCount}`);
  console.log(`Pending image enrichment:      ${result.pendingImageEnrichmentCount}`);
  console.log(`Rejected (mock/demo/unverified): ${result.rejectedCount}`);
  console.log(
    "Wrote data/processed/display-records.json, pending-image-enrichment.json, rejected-records.json, display-eligibility-report.json"
  );
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during triage:records:", error);
    process.exitCode = 1;
  });
}
