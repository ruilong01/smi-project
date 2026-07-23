import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRY_ATLAS_NAMES, COUNTRY_NAMES, OPENALEX_EXCLUDE_TERMS } from "./config.mjs";
import { verifyCrossrefDoi } from "./adapters/crossref.adapter.mjs";
import {
  classifyText,
  detectTechnologies,
  firstSentence,
  isStrongMaritimeMatch,
  reconstructAbstract,
  slugify,
} from "./normalization.mjs";
import { delayMs } from "./http.mjs";
import { normalizeResearchRecord } from "../processing/normalizeResearchRecord.mjs";
import { buildTriageOutputFiles } from "./triageRecords.mjs";

// Turns every raw data/raw/openalex/*.json run file into
// data/processed/research-records.json - one entry per real, deduplicated
// OpenAlex work, every field traceable back to the exact raw file it came
// from. Nothing here invents a record; a work that doesn't pass the
// maritime-relevance check is dropped, not padded with placeholder text.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultRawOpenAlexDir = path.join(rootDir, "data/raw/openalex");
const defaultOutputDir = path.join(rootDir, "data/processed");
const MAX_CROSSREF_VERIFICATIONS = 40; // keep the polite-pool call count bounded per run

function containsExcludeTerm(text) {
  const haystack = text.toLowerCase();
  return OPENALEX_EXCLUDE_TERMS.some((term) => haystack.includes(term));
}

function getInstitutions(work) {
  const institutions = [];
  work.authorships?.forEach((authorship) => {
    authorship.institutions?.forEach((institution) => {
      if (institution?.id && !institutions.some((item) => item.id === institution.id)) {
        institutions.push(institution);
      }
    });
  });
  return institutions;
}

function getPublicationDate(work) {
  return (
    work.publication_date ||
    [work.publication_year, "01", "01"].filter(Boolean).join("-")
  );
}

function recordTypeFromWork(work) {
  const type = (work.type ?? "").toLowerCase();
  if (type.includes("dataset")) return "dataset";
  if (type.includes("article") || type.includes("preprint") || type.includes("review")) {
    return "publication";
  }
  return "unknown";
}

async function listRawRunFiles(rawDir) {
  try {
    const entries = await fs.readdir(rawDir);
    return entries.filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

// A previous, separate pipeline (npm run ingest:media-seed) already writes
// real, source-backed CORDIS records into this exact output path. This run
// must NOT silently delete them just because it doesn't recognise the
// shape - every non-OpenAlex record is passed through the SAME shared
// normalizeResearchRecord() that ingestMediaSeed.mjs uses, so both
// pipelines agree on field names and on what "verified" means. Only
// "openalex-*" record ids are ever replaced by this function's own output.
function loadNonOpenAlexRecords(previousRecords, nowIso) {
  return previousRecords
    .filter((record) => !record.recordId?.startsWith("openalex-"))
    .map((record) => normalizeResearchRecord(record, { nowIso }));
}

// Fields that must survive process:records for a record that already had
// them - this is the exact guarantee the schema/provenance fix exists to
// enforce (acronym/topic/image fields were previously being dropped here
// for every CORDIS media-seed record). A record with no value for a field
// before is exempt (nothing to preserve); a record that HAD a value and now
// doesn't is a hard failure, not a warning.
const PRESERVED_FIELDS = [
  "acronym",
  "topicPrimary",
  "topicSecondary",
  "sourceUrls",
  "summary",
  "evidenceSnippet",
  "whyUseful",
  "actionabilityScore",
  "relevanceScore",
  "imageIds",
  "hasImageCandidates",
  "verificationStatus",
  "dataOrigin",
];

function isEmptyValue(value) {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function validateFieldPreservation(previousRecords, newRecords) {
  const newById = new Map(newRecords.map((record) => [record.recordId, record]));
  const problems = [];

  for (const previousRecord of previousRecords) {
    const newRecord = newById.get(previousRecord.recordId);
    if (!newRecord) {
      problems.push(`Record ${previousRecord.recordId} disappeared entirely during process:records.`);
      continue;
    }
    for (const field of PRESERVED_FIELDS) {
      const before = previousRecord[field];
      const after = newRecord[field];
      if (!isEmptyValue(before) && isEmptyValue(after)) {
        problems.push(
          `Record ${previousRecord.recordId} lost field "${field}" (was ${JSON.stringify(before)}, now ${JSON.stringify(after)}).`
        );
      }
    }
  }

  return problems;
}

function buildRecordFromWork({ work, query, sourceRelativePath, runFetchedAt, nowIso }) {
  const title = work.title || work.display_name;
  const abstract = work.abstract || reconstructAbstract(work.abstract_inverted_index);
  const text = `${title} ${abstract} ${(work.concepts ?? []).map((c) => c.display_name).join(" ")}`;

  if (!title) {
    return { record: null, reason: "missing_title" };
  }
  if (containsExcludeTerm(text)) {
    return { record: null, reason: "excluded_term_match" };
  }
  if (!isStrongMaritimeMatch(text)) {
    return { record: null, reason: "not_strong_maritime_match" };
  }

  const institutions = getInstitutions(work);
  const leadInstitution = institutions[0];
  const countryCode = leadInstitution?.country_code ?? null;
  const countrySupported = countryCode ? Boolean(COUNTRY_ATLAS_NAMES[countryCode]) : false;

  const categories = classifyText(text);
  const technologies = detectTechnologies(text);
  const doi = work.doi?.replace("https://doi.org/", "") ?? "";
  const openAlexUrl = work.id;
  const primaryLandingUrl = work.primary_location?.landing_page_url ?? null;
  const openAccessUrl = work.open_access?.oa_url ?? work.best_oa_location?.pdf_url ?? null;
  const publicationDate = getPublicationDate(work);

  const sourceUrls = [primaryLandingUrl, openAccessUrl, doi ? `https://doi.org/${doi}` : null].filter(
    Boolean
  );

  const dataQualityFlags = [];
  if (!abstract) dataQualityFlags.push("missing_abstract");
  if (!countryCode) dataQualityFlags.push("missing_country");
  else if (!countrySupported) dataQualityFlags.push("country_not_in_supported_list");
  if (!leadInstitution) dataQualityFlags.push("missing_institution");
  if (categories.length === 0) dataQualityFlags.push("no_matched_category");
  if (!doi) dataQualityFlags.push("missing_doi");

  const record = {
    recordId: `openalex-${slugify(work.id)}`,
    recordType: recordTypeFromWork(work),
    title,
    summary: firstSentence(abstract, `Publication-backed maritime R&D record: ${title}.`),
    abstract,
    sourceDatabase: "OpenAlex",
    sourceUrls,
    doi,
    openAlexUrl,
    rawSourceFiles: [sourceRelativePath],
    publicationDate,
    countryCode: countrySupported ? countryCode : null,
    countryName: countrySupported ? COUNTRY_NAMES[countryCode] : null,
    institution: leadInstitution?.display_name ?? "",
    institutionId: leadInstitution?.id ?? "",
    categories,
    technologies,
    matchedQuery: query,
    extractedAt: runFetchedAt,
    processedAt: nowIso,
    verificationStatus:
      sourceUrls.length > 0 || Boolean(openAlexUrl) || Boolean(doi) ? "verified" : "metadata_only",
    dataOrigin: "api_extracted",
    fieldProvenance: {
      title: "source",
      summary: abstract ? "source" : "missing",
      abstract: abstract ? "source" : "missing",
      image: "missing",
      country: countryCode ? (countrySupported ? "source" : "inferred") : "missing",
      institution: leadInstitution ? "source" : "missing",
    },
    dataQualityFlags,
    crossrefVerified: false,
  };

  return { record, reason: null };
}

export async function processRecords({
  rawOpenAlexDir = defaultRawOpenAlexDir,
  outputDir = defaultOutputDir,
  // Where to read pre-existing non-OpenAlex records from (e.g. the
  // media-seed pipeline's CORDIS records) to carry forward. This is
  // deliberately independent of `outputDir` - when refreshData.mjs calls
  // this targeting a temp directory, the *active* live file (not the
  // empty temp one) is still the correct place to read them from.
  previousOutputPath = path.join(defaultOutputDir, "research-records.json"),
  nowIso = new Date().toISOString(),
  verifyDoisWithCrossref = true,
} = {}) {
  const runFiles = await listRawRunFiles(rawOpenAlexDir);
  if (runFiles.length === 0) {
    throw new Error(
      `No raw OpenAlex run files found in ${rawOpenAlexDir} - run \`npm run fetch:openalex\` first.`
    );
  }

  // Read once, up front, so both the OpenAlex-rebuild loop below and
  // loadNonOpenAlexRecords() share the same snapshot of what was already
  // there before this run.
  const previousData = await readJsonIfExists(previousOutputPath);
  const previousRecords = previousData?.records ?? [];
  const previousRecordsById = new Map(previousRecords.map((r) => [r.recordId, r]));

  const recordsById = new Map();
  const dropReasons = {};
  let totalRawWorks = 0;

  for (const fileName of runFiles) {
    const filePath = path.join(rawOpenAlexDir, fileName);
    const relativePath = path.relative(rootDir, filePath);
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));

    for (const { query, work } of raw.works ?? []) {
      totalRawWorks++;
      const { record, reason } = buildRecordFromWork({
        work,
        query,
        sourceRelativePath: relativePath,
        runFetchedAt: raw.fetchedAt ?? nowIso,
        nowIso,
      });

      if (!record) {
        dropReasons[reason] = (dropReasons[reason] ?? 0) + 1;
        continue;
      }

      const existing = recordsById.get(record.recordId);
      if (existing) {
        // Later run files win, but keep the union of raw source files so
        // provenance shows every run that ever surfaced this record.
        record.rawSourceFiles = [...new Set([...existing.rawSourceFiles, ...record.rawSourceFiles])];
      }

      // buildRecordFromWork always starts a record with no images -
      // enrich:images (scripts/ingestion/enrichImages.mjs) is what finds
      // them afterwards, as a separate deliberate step, and this loop
      // rebuilds every OpenAlex record from the raw fetch file every run.
      // Carry forward whatever enrich:images already found (and its
      // lastImageAttemptAt cooldown marker) so re-running process:records
      // doesn't silently erase that work.
      const previousRecord = previousRecordsById.get(record.recordId);
      if (previousRecord) {
        if (!record.imageIds?.length && previousRecord.imageIds?.length) {
          record.images = previousRecord.images ?? [];
          record.imageIds = previousRecord.imageIds;
          record.hasImageCandidates = previousRecord.hasImageCandidates;
          record.imageCandidateCount = previousRecord.imageCandidateCount;
        }
        if (previousRecord.lastImageAttemptAt) {
          record.lastImageAttemptAt = previousRecord.lastImageAttemptAt;
        }
      }

      // Route through the same shared normalizer the media-seed pipeline
      // uses, so verificationStatus is decided by ONE rule for every
      // record regardless of which pipeline produced it.
      recordsById.set(record.recordId, normalizeResearchRecord(record, { nowIso }));
    }
  }

  const openAlexRecords = [...recordsById.values()];
  const preservedNonOpenAlexRecords = loadNonOpenAlexRecords(previousRecords, nowIso);
  const records = [...preservedNonOpenAlexRecords, ...openAlexRecords];

  if (verifyDoisWithCrossref) {
    const withDoi = records.filter((r) => r.doi).slice(0, MAX_CROSSREF_VERIFICATIONS);
    for (const record of withDoi) {
      try {
        const verification = await verifyCrossrefDoi(record.doi, nowIso);
        if (verification) {
          record.crossrefVerified = true;
          record.sourceUrls = [...new Set([...record.sourceUrls, verification.source.url])];
        }
      } catch {
        // Crossref verification is a bonus signal, never a hard requirement.
      }
      await delayMs(500);
    }
  }

  await fs.mkdir(outputDir, { recursive: true });

  const droppedCount = totalRawWorks - openAlexRecords.length;
  const output = {
    generatedAt: nowIso,
    rawRunFilesProcessed: runFiles.length,
    totalRawWorksSeen: totalRawWorks,
    openAlexRecordCount: openAlexRecords.length,
    preservedNonOpenAlexRecordCount: preservedNonOpenAlexRecords.length,
    recordCount: records.length,
    droppedCount,
    dropReasons,
    records,
  };

  // display-records.json / pending-image-enrichment.json / rejected-
  // records.json / display-eligibility-report.json are derived from the
  // exact same `records` array research-records.json is about to get, and
  // are written through the SAME temp-write/validate/backup/swap safeguard
  // below - triage is not a separate, less-safe write step bolted on
  // afterwards.
  const triageFiles = buildTriageOutputFiles(records, { nowIso });
  const filesToWrite = { "research-records.json": output, ...triageFiles };

  const runToken = Date.now();
  const tempPaths = Object.fromEntries(
    Object.keys(filesToWrite).map((fileName) => [fileName, path.join(outputDir, `.${fileName}.tmp-${runToken}`)])
  );

  for (const [fileName, content] of Object.entries(filesToWrite)) {
    await fs.writeFile(tempPaths[fileName], `${JSON.stringify(content, null, 2)}\n`);
  }

  // Guard against exactly the bug this fix exists to close: a CORDIS
  // media-seed record silently losing its acronym/topic/image fields
  // because this script's own field mapping didn't preserve them. Compares
  // against previousRecords (the file previousOutputPath pointed at before
  // this run), not the fresh output - so this still works when outputDir is
  // a temp directory (refreshData.mjs's own atomic-swap flow).
  const preservationProblems = validateFieldPreservation(previousRecords, records);
  if (preservationProblems.length > 0) {
    await Promise.all(Object.values(tempPaths).map((p) => fs.rm(p, { force: true })));
    throw new Error(
      `process:records aborted - field preservation check failed for ${preservationProblems.length} record field(s):\n` +
        preservationProblems.slice(0, 20).join("\n") +
        (preservationProblems.length > 20 ? `\n...and ${preservationProblems.length - 20} more.` : "")
    );
  }

  for (const fileName of Object.keys(filesToWrite)) {
    const finalPath = path.join(outputDir, fileName);
    const backupPath = path.join(outputDir, `${fileName}.bak`);
    const previousFileExists = await fs
      .access(finalPath)
      .then(() => true)
      .catch(() => false);
    if (previousFileExists) {
      await fs.copyFile(finalPath, backupPath);
    }
    await fs.rename(tempPaths[fileName], finalPath);
  }

  const outputPath = path.join(outputDir, "research-records.json");
  const displayEligibleCount = triageFiles["display-records.json"].recordCount;
  const pendingCount = triageFiles["pending-image-enrichment.json"].recordCount;
  const rejectedCount = triageFiles["rejected-records.json"].recordCount;

  console.log(
    `[process:records] ${openAlexRecords.length} OpenAlex records kept (${droppedCount} dropped) + ${preservedNonOpenAlexRecords.length} preserved non-OpenAlex records = ${records.length} total, from ${runFiles.length} raw run file(s) -> ${path.relative(rootDir, outputPath)}`
  );
  console.log(
    `[process:records] Field preservation check passed for ${previousRecords.length} previously-existing record(s).`
  );
  console.log(
    `[process:records] Display eligible: ${displayEligibleCount}, pending image enrichment: ${pendingCount}, rejected: ${rejectedCount}.`
  );

  return {
    outputPath,
    recordCount: records.length,
    droppedCount,
    dropReasons,
    displayEligibleCount,
    pendingImageEnrichmentCount: pendingCount,
    rejectedCount,
  };
}

async function main() {
  await processRecords();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during record processing:", error);
    process.exitCode = 1;
  });
}
