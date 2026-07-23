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

// A previous, separate pipeline (npm run ingest:media-seed) already writes
// real, source-backed CORDIS records into this exact output path, in an
// older/simpler schema. This run must NOT silently delete them just
// because it doesn't recognise the shape - convert them to the current
// provenance schema (dataOrigin: "manual_seed", one of the schema's own
// allowed values) and carry them forward untouched otherwise. Only
// "openalex-*" record ids are ever replaced by this function's own output.
async function loadNonOpenAlexRecords(outputPath, nowIso) {
  let existing;
  try {
    existing = JSON.parse(await fs.readFile(outputPath, "utf8"));
  } catch {
    return [];
  }

  return (existing.records ?? [])
    .filter((record) => !record.recordId?.startsWith("openalex-"))
    .map((record) => {
      // Already in the current schema (e.g. re-running on an output this
      // same script already wrote) - keep as-is.
      if (record.fieldProvenance && record.dataOrigin) {
        return record;
      }

      // Legacy ingestMediaSeed.mjs shape - convert.
      const countryCode = record.countryCode ?? null;
      return {
        recordId: record.recordId,
        recordType: "funded_project",
        title: record.title,
        summary: record.summary || record.whyUseful || record.title,
        abstract: record.evidenceSnippet || "",
        sourceDatabase: record.sourceDatabase || "unknown",
        sourceUrls: record.sourceUrl ? [record.sourceUrl] : [],
        doi: "",
        openAlexUrl: "",
        rawSourceFiles: ["data/seed/maritime_rnd_records_with_image_candidates.json"],
        publicationDate: record.extractedAt ? String(record.extractedAt).slice(0, 10) : "",
        countryCode,
        countryName: countryCode ? COUNTRY_NAMES[countryCode] ?? null : null,
        institution: record.coordinator || "",
        institutionId: "",
        categories: [],
        technologies: [],
        matchedQuery: null,
        extractedAt: record.extractedAt ?? nowIso,
        processedAt: nowIso,
        verificationStatus: record.sourceUrl ? "verified" : "metadata_only",
        dataOrigin: "manual_seed",
        fieldProvenance: {
          title: "source",
          summary: "source",
          abstract: record.evidenceSnippet ? "source" : "missing",
          image: record.hasImageCandidates ? "source_candidate" : "missing",
          country: countryCode ? "source" : "missing",
          institution: record.coordinator ? "source" : "missing",
        },
        dataQualityFlags: countryCode ? [] : ["missing_country"],
        crossrefVerified: false,
      };
    });
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
      recordsById.set(record.recordId, record);
    }
  }

  const openAlexRecords = [...recordsById.values()];
  const preservedNonOpenAlexRecords = await loadNonOpenAlexRecords(previousOutputPath, nowIso);
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

  const outputPath = path.join(outputDir, "research-records.json");
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);

  console.log(
    `[process:records] ${openAlexRecords.length} OpenAlex records kept (${droppedCount} dropped) + ${preservedNonOpenAlexRecords.length} preserved non-OpenAlex records = ${records.length} total, from ${runFiles.length} raw run file(s) -> ${path.relative(rootDir, outputPath)}`
  );

  return { outputPath, recordCount: records.length, droppedCount, dropReasons };
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
