import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Generates heuristic (NOT AI) plain-language explanation fields for
// records that don't have one yet in data/processed/research-evaluations.json.
// Every field is either a real, already-sourced piece of text the record
// already carries (its own summary/evidenceSnippet/whyUseful/topics) or a
// plainly templated sentence built only from those same fields - nothing
// here invents a claim the source data doesn't already support. This is
// the same template scripts/ingestion/enrichTestMedia.mjs proved out on a
// small fixed set of CORDIS records, generalized to run over any record
// and to understand the normalized (camelCase) record shape.
//
// Only runs for records that are eligible (or about to be, once imaged) -
// see the `eligibleOnly` filter below - so this doesn't spend effort
// writing explanations for records that will never be shown anyway.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");

function buildEvaluation(record, nowIso) {
  const basedOnFields = [];

  const plainLanguageExplanation = record.summary || `${record.title}.`;
  if (record.summary) basedOnFields.push("summary");

  const problemBeingAddressed =
    record.evidenceSnippet || `This project addresses challenges within ${record.topicPrimary || "maritime R&D"}.`;
  if (record.evidenceSnippet) basedOnFields.push("evidenceSnippet");

  const technologyApproach =
    record.whyUseful || "Technology approach not detailed beyond the project summary in current source data.";
  if (record.whyUseful) basedOnFields.push("whyUseful");

  const topics = [record.topicPrimary, record.topicSecondary].filter(Boolean).join(" and ");
  if (record.topicPrimary) basedOnFields.push("topicPrimary");
  if (record.topicSecondary) basedOnFields.push("topicSecondary");
  const maritimeRelevance = topics
    ? `Directly relevant to ${topics} within maritime R&D.`
    : "Relevance classified from source metadata only.";

  const possibleApplication = topics
    ? `Potentially applicable to maritime operators and researchers working on ${topics}, pending review of full project outcomes.`
    : "Application area not specified in current source data.";

  const whyItMatters = record.whyUseful || "Selected for inclusion based on its match to tracked maritime R&D categories.";

  if (record.followUpStatus) basedOnFields.push("followUpStatus");
  const followUpOrActionSignal = record.followUpStatus
    ? `Follow-up status: ${record.followUpStatus.replace(/_/g, " ")}.`
    : "No follow-up status recorded in current source data.";

  const limitations =
    record.dataOrigin === "api_extracted"
      ? "Based on publication metadata and abstract text; full text has not been reviewed."
      : "Based on project metadata, summary and coordinator-page evidence gathered so far; full technical publications and outcome reports have not been reviewed.";

  return {
    recordId: record.recordId,
    plainLanguageExplanation,
    problemBeingAddressed,
    technologyApproach,
    maritimeRelevance,
    possibleApplication,
    whyItMatters,
    followUpOrActionSignal,
    limitations,
    explanationProvenance: {
      basedOnFields,
      aiGenerated: false,
      model: null,
      promptVersion: "heuristic-template-v1",
      generatedAt: nowIso,
    },
  };
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export async function enrichExplanations({
  processedDir = defaultProcessedDir,
  eligibleOnly = true,
  nowIso = new Date().toISOString(),
} = {}) {
  const researchRecordsPath = path.join(processedDir, "research-records.json");
  const evaluationsPath = path.join(processedDir, "research-evaluations.json");
  const researchRecordsData = JSON.parse(await fs.readFile(researchRecordsPath, "utf8"));
  const evaluationsData = await readJsonIfExists(evaluationsPath, { evaluations: [] });

  const existingIds = new Set((evaluationsData.evaluations ?? []).map((e) => e.recordId));
  const candidates = researchRecordsData.records.filter((record) => {
    if (existingIds.has(record.recordId)) return false;
    if (eligibleOnly && !record.displayEligible) return false;
    return Boolean(record.summary || record.evidenceSnippet || record.whyUseful);
  });

  const newEvaluations = candidates.map((record) => buildEvaluation(record, nowIso));
  const allEvaluations = [...(evaluationsData.evaluations ?? []), ...newEvaluations];

  await fs.writeFile(
    evaluationsPath,
    `${JSON.stringify({ generatedAt: nowIso, recordCount: allEvaluations.length, evaluations: allEvaluations }, null, 2)}\n`
  );

  return { checked: researchRecordsData.records.length, generated: newEvaluations.length, totalEvaluations: allEvaluations.length };
}

async function main() {
  const result = await enrichExplanations();
  console.log("\n" + "=".repeat(60));
  console.log("Explanation Enrichment Summary");
  console.log("=".repeat(60));
  console.log(`Records checked:        ${result.checked}`);
  console.log(`New evaluations generated: ${result.generated}`);
  console.log(`Total evaluations on file: ${result.totalEvaluations}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during enrich:explanations:", error);
    process.exitCode = 1;
  });
}
