import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractWebpage } from "./enrichment/extractWebpage.mjs";
import { shouldHideImage } from "./aiCuration/verdict.mjs";
import { delayMs } from "./http.mjs";

// Small vertical-slice test of the real fetch -> process -> app pipeline
// (npm run enrich:test-media): picks a handful of real, high-actionability
// CORDIS records already in data/seed/, fetches their OWN official project
// websites live (never the generic CORDIS fact-sheet page, which has no
// embedded images per direct testing), extracts real <img> tags with
// cheerio (no AI web-fetching, per project rules), and builds heuristic
// (non-AI) explanations from fields the source data already provides.
//
// A record that has no reachable official site, or whose site blocks
// scraping, ends up with genuinely zero new images - this is reported
// honestly, never padded with a placeholder or stock photo.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const seedDir = path.join(rootDir, "data/seed");
const processedDir = path.join(rootDir, "data/processed");
const rawMediaDir = path.join(rootDir, "data/raw/media-candidates");
const legacyDatasetPath = path.join(rootDir, "src/data/generated/liveResearchData.json");
const imageCandidatesPath = path.join(processedDir, "image-candidates.json");
const evaluationsPath = path.join(processedDir, "research-evaluations.json");
const reportPath = path.join(processedDir, "enrichment-test-report.json");

// The "good examples" acronyms - all real CORDIS Horizon projects already
// present in data/seed/, chosen for high actionability + real source URLs.
const SELECTED_ACRONYMS = [
  "GAMMA",
  "DYNAPORT",
  "TwinShip",
  "AUTOFLEX",
  "MERLIN",
  "DT4GS",
  "SAFeCRAFT",
  "MISSION",
];

const MAX_IMAGES_PER_RECORD = 5;
const REQUEST_DELAY_MS = 1500;
const SKIP_URL_PATTERN = /favicon|sprite|pixel\.gif|1x1|spacer\.(png|gif)/i;

function classifyImageType(image) {
  const haystack = `${image.altText} ${image.caption} ${image.imageUrl}`.toLowerCase();
  if (/logo|flag|badge/.test(haystack)) return "logo";
  if (/infographic|diagram|chart|scheme|workflow|framework/.test(haystack)) return "infographic";
  if (/vessel|\bship\b|boat|craft|tanker|carrier|bulk carrier/.test(haystack)) return "pilot_vessel";
  if (/hero|banner|cover/.test(haystack)) return "project_hero";
  return "source_preview";
}

// The project's OWN official website is where real photos/graphics live -
// the generic CORDIS fact-sheet page is metadata-only (confirmed via
// direct testing: 0 embedded <img> tags across every record checked).
function pickBestSourceUrl(record) {
  return record.hero_image_source_url || record.source_url;
}

async function fetchRecordImages(record, nowIso, log) {
  const targetUrl = pickBestSourceUrl(record);
  if (!targetUrl) {
    return { images: [], rawFile: null, error: "No official source URL available for this record." };
  }

  try {
    const result = await extractWebpage(targetUrl, { requestDelayMs: REQUEST_DELAY_MS });

    await fs.mkdir(rawMediaDir, { recursive: true });
    const rawFilePath = path.join(rawMediaDir, `${record.record_id}.json`);
    await fs.writeFile(
      rawFilePath,
      `${JSON.stringify(
        { recordId: record.record_id, acronym: record.acronym, fetchedUrl: targetUrl, fetchedAt: nowIso, ...result },
        null,
        2
      )}\n`
    );

    const images = result.images
      .filter((image) => !SKIP_URL_PATTERN.test(image.imageUrl))
      .slice(0, MAX_IMAGES_PER_RECORD)
      .map((image, index) => ({
        imageId: `${record.record_id}-live-${index + 1}`,
        recordId: record.record_id,
        imageUrl: image.imageUrl,
        caption: image.caption || "",
        altText: image.altText || "",
        sourceUrl: targetUrl,
        sourceName: result.pageTitle || new URL(targetUrl).hostname,
        imageType: classifyImageType(image),
        canEmbed: false,
        rightsNote: "Rights not verified; use as linked preview only, do not claim as cleared for reuse.",
        fetchedAt: nowIso,
        origin: "enrich-test-media",
      }));

    log(
      `  ${record.acronym}: fetched ${targetUrl} -> ${images.length} image candidate(s) kept (${result.images.length} found on page)`
    );
    return { images, rawFile: path.relative(rootDir, rawFilePath), error: null };
  } catch (error) {
    log(`  ${record.acronym}: FAILED to fetch ${targetUrl} - ${error.message}`);
    return { images: [], rawFile: null, error: error.message };
  }
}

// Heuristic/template explanation builder - NOT AI. Every field is either a
// direct real, already-sourced piece of text from the seed record (its
// CORDIS-derived summary/evidence snippet/why-useful, all human-written
// during the original media-seed curation) or a plainly templated sentence
// built only from the record's own topic/status fields. Nothing here
// invents a claim the source data doesn't already support.
function buildEvaluation(record, nowIso) {
  const basedOnFields = [];

  const plainLanguageExplanation = record.summary || `${record.title}.`;
  if (record.summary) basedOnFields.push("summary");

  const problemBeingAddressed =
    record.evidence_snippet ||
    `This project addresses challenges within ${record.topic_primary || "maritime R&D"}.`;
  if (record.evidence_snippet) basedOnFields.push("evidence_snippet");

  const technologyApproach =
    record.why_useful ||
    "Technology approach not detailed beyond the project summary in current source data.";
  if (record.why_useful) basedOnFields.push("why_useful");

  const topics = [record.topic_primary, record.topic_secondary].filter(Boolean).join(" and ");
  if (record.topic_primary) basedOnFields.push("topic_primary");
  if (record.topic_secondary) basedOnFields.push("topic_secondary");
  const maritimeRelevance = topics
    ? `Directly relevant to ${topics} within maritime R&D.`
    : "Relevance classified from source metadata only.";

  const possibleApplication = topics
    ? `Potentially applicable to maritime operators and researchers working on ${topics}, pending review of full project outcomes.`
    : "Application area not specified in current source data.";

  const whyItMatters =
    record.why_useful || "Selected for inclusion based on its match to tracked maritime R&D categories.";

  if (record.follow_up_status) basedOnFields.push("follow_up_status");
  const followUpOrActionSignal = record.follow_up_status
    ? `Follow-up status: ${record.follow_up_status.replace(/_/g, " ")}.`
    : "No follow-up status recorded in current source data.";

  const limitations =
    "Based on project metadata, summary and coordinator-page evidence gathered so far; full technical publications and outcome reports have not been reviewed.";

  return {
    recordId: record.record_id,
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

async function main() {
  const nowIso = new Date().toISOString();
  const log = (msg) => console.log(msg);

  await fs.mkdir(rawMediaDir, { recursive: true });
  await fs.mkdir(processedDir, { recursive: true });

  const seed = JSON.parse(
    await fs.readFile(path.join(seedDir, "maritime_rnd_records_with_image_candidates.json"), "utf8")
  );
  const selectedRecords = seed.records.filter((r) => SELECTED_ACRONYMS.includes(r.acronym));

  log("\n" + "=".repeat(60));
  log(`enrich:test-media - vertical slice test (${selectedRecords.length} of ${SELECTED_ACRONYMS.length} requested records found)`);
  log("=".repeat(60));

  // ---- Part 2: fetch real image candidates, one record at a time ----
  const newImagesByRecord = new Map();
  const fetchResults = [];
  for (const record of selectedRecords) {
    const { images, rawFile, error } = await fetchRecordImages(record, nowIso, log);
    newImagesByRecord.set(record.record_id, images);
    fetchResults.push({ recordId: record.record_id, acronym: record.acronym, rawFile, error });
    await delayMs(REQUEST_DELAY_MS);
  }

  // ---- Merge into data/processed/image-candidates.json ----
  // Preserve everything already there; drop only this script's OWN prior
  // output for these same records first (idempotent re-run), then dedupe
  // by imageUrl so re-fetching the same page never creates duplicates.
  const existingImageData = await readJsonIfExists(imageCandidatesPath, { images: [] });
  const selectedRecordIds = new Set(selectedRecords.map((r) => r.record_id));
  const keptExisting = (existingImageData.images ?? []).filter(
    (img) => !(img.origin === "enrich-test-media" && selectedRecordIds.has(img.recordId))
  );

  const seenUrls = new Set(keptExisting.map((img) => img.imageUrl));
  const dedupedNewImages = [];
  for (const img of newImagesByRecord.values()) {
    for (const image of img) {
      if (seenUrls.has(image.imageUrl)) continue;
      seenUrls.add(image.imageUrl);
      image.aiCuration = {
        status: "pending",
        verdict: null,
        score: null,
        reason: "AI curation API not configured yet (set AI_CURATION_API_URL / AI_CURATION_API_KEY).",
        assessedAt: null,
        model: null,
      };
      dedupedNewImages.push(image);
    }
  }

  const mergedImages = [...keptExisting, ...dedupedNewImages];
  await fs.writeFile(
    imageCandidatesPath,
    `${JSON.stringify({ generatedAt: nowIso, imageCandidateCount: mergedImages.length, images: mergedImages }, null, 2)}\n`
  );

  // ---- Part 3: heuristic evaluations ----
  const evaluations = selectedRecords.map((record) => buildEvaluation(record, nowIso));
  await fs.writeFile(
    evaluationsPath,
    `${JSON.stringify({ generatedAt: nowIso, recordCount: evaluations.length, evaluations }, null, 2)}\n`
  );

  // ---- Part 4: embed into the legacy dataset the frontend bundles ----
  const dataset = await readJsonIfExists(legacyDatasetPath, null);
  let projectsUpdated = 0;
  if (dataset) {
    const evaluationsByRecordId = new Map(evaluations.map((e) => [e.recordId, e]));
    (dataset.projects ?? []).forEach((project) => {
      if (!project.id.startsWith("project-mediaseed-")) return;
      const recordId = project.id.replace("project-mediaseed-", "");
      if (!selectedRecordIds.has(recordId)) return;

      const evaluation = evaluationsByRecordId.get(recordId);
      if (evaluation) {
        project.plainLanguageExplanation = evaluation.plainLanguageExplanation;
        project.problemBeingAddressed = evaluation.problemBeingAddressed;
        project.technologyApproach = evaluation.technologyApproach;
        project.maritimeRelevance = evaluation.maritimeRelevance;
        project.possibleApplication = evaluation.possibleApplication;
        project.whyItMatters = evaluation.whyItMatters;
        project.followUpOrActionSignal = evaluation.followUpOrActionSignal;
        project.limitations = evaluation.limitations;
        project.explanationProvenance = evaluation.explanationProvenance;
      }

      const freshImages = (newImagesByRecord.get(recordId) ?? []).filter(
        (img) => !shouldHideImage(img.aiCuration)
      );
      if (freshImages.length && project.sourcePages?.[0]) {
        const existingSourceImages = project.sourcePages[0].images ?? [];
        const existingSourceUrls = new Set(existingSourceImages.map((i) => i.imageUrl));
        const toAdd = freshImages
          .filter((i) => !existingSourceUrls.has(i.imageUrl))
          .map((i) => ({
            imageUrl: i.imageUrl,
            altText: i.altText,
            caption: i.caption,
            sourceUrl: i.sourceUrl,
            canEmbed: false,
            rightsNote: i.rightsNote,
          }));
        project.sourcePages[0].images = [...existingSourceImages, ...toAdd];
      }
      projectsUpdated++;
    });
    await fs.writeFile(legacyDatasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
  }

  // ---- Part 8: provenance / test-proof report ----
  const reportEntries = selectedRecords.map((record) => {
    const evaluation = evaluations.find((e) => e.recordId === record.record_id);
    const totalImagesForRecord = mergedImages.filter((i) => i.recordId === record.record_id).length;
    const fetchResult = fetchResults.find((f) => f.recordId === record.record_id);
    return {
      recordId: record.record_id,
      acronym: record.acronym,
      sourceUrls: [record.source_url, record.hero_image_source_url].filter(Boolean),
      imageCandidateCount: totalImagesForRecord,
      newImagesFetchedThisRun: (newImagesByRecord.get(record.record_id) ?? []).length,
      explanationStatus: evaluation ? "heuristic_generated" : "missing",
      rawFetchFiles: fetchResult?.rawFile ? [fetchResult.rawFile] : [],
      processedFiles: [
        "data/processed/image-candidates.json",
        "data/processed/research-evaluations.json",
        "src/data/generated/liveResearchData.json",
      ],
      fetchError: fetchResult?.error ?? null,
      updatedAt: nowIso,
    };
  });

  const recordsWithNoImages = reportEntries.filter((e) => e.imageCandidateCount === 0).map((e) => e.acronym);
  const recordsWithMissingExplanations = reportEntries
    .filter((e) => e.explanationStatus === "missing")
    .map((e) => e.acronym);

  const report = {
    generatedAt: nowIso,
    selectedRecords: reportEntries.map((e) => e.acronym),
    recordCount: reportEntries.length,
    totalNewImagesFetchedThisRun: [...newImagesByRecord.values()].flat().length,
    recordsWithNoImages,
    recordsWithMissingExplanations,
    entries: reportEntries,
    dataFilesUpdated: [
      "data/processed/image-candidates.json",
      "data/processed/research-evaluations.json",
      "src/data/generated/liveResearchData.json",
      "data/processed/enrichment-test-report.json",
    ],
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  log("\n" + "=".repeat(60));
  log("Enrichment Test Summary");
  log("=".repeat(60));
  log(`Records selected:                 ${selectedRecords.length}`);
  log(`New images fetched this run:       ${report.totalNewImagesFetchedThisRun}`);
  log(`Records with zero images total:    ${recordsWithNoImages.join(", ") || "none"}`);
  log(`Evaluations generated:             ${evaluations.length}`);
  log(`Projects updated in legacy dataset:${projectsUpdated}`);
  log(`Report written to data/processed/enrichment-test-report.json`);
  log("=".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("Fatal error during enrich:test-media:", error.message);
  process.exitCode = 1;
});
