import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COUNTRY_ATLAS_NAMES } from "./config.mjs";
import {
  classifyText,
  detectTechnologies,
  firstSentence,
  hashContent,
  slugify,
} from "./normalization.mjs";
import { emptyAiFields } from "./enrichment/schemaDefaults.mjs";
import { buildDataset } from "./buildDataset.mjs";
import { shouldHideImage } from "./aiCuration/verdict.mjs";
import { normalizeResearchRecord } from "../processing/normalizeResearchRecord.mjs";

// Ingests the static, human-curated media-enabled seed dataset (CORDIS
// project records with image candidates) into:
//   1. data/processed/research-records.json  - full audit trail, every record
//   2. data/processed/image-candidates.json  - full audit trail, every image
//   3. src/data/generated/liveResearchData.json - only the subset that can be
//      honestly attributed to a single country (see deriveCountryCode below)
//
// No network calls here - this is a one-time transform of a static seed
// file, not a live extraction. No images are downloaded; only URLs and
// metadata are stored (image_policy in the seed file: "store URL not file").

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const seedDir = path.join(rootDir, "data/seed");
const processedDir = path.join(rootDir, "data/processed");
const generatedPath = path.join(rootDir, "src/data/generated/liveResearchData.json");

const RECORDS_SEED_FILE = "maritime_rnd_records_with_image_candidates.json";
const IMAGES_CSV_FILE = "maritime_rnd_image_candidates.csv";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      pushField();
    } else if (char === "\n") {
      if (field.endsWith("\r")) field = field.slice(0, -1);
      pushRow();
    } else {
      field += char;
    }
  }
  if (field.length || row.length) pushRow();

  const nonEmptyRows = rows.filter((cols) => cols.length > 1 || cols[0] !== "");
  const [header, ...dataRows] = nonEmptyRows;
  return dataRows.map((cols) =>
    Object.fromEntries(header.map((key, index) => [key, cols[index] ?? ""]))
  );
}

// Only attach a record to a country pin when the source text names exactly
// one recognised country as the coordinator - "EU / multi-country
// consortium" with no named coordinator is real data but NOT a country
// attribution, and must not be forced onto one to make the map look fuller.
function deriveCountryCode(countryOrRegion, coordinator) {
  const haystack = `${countryOrRegion ?? ""} ${coordinator ?? ""}`;
  const matches = Object.entries(COUNTRY_ATLAS_NAMES).filter(([, name]) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
  });

  return matches.length === 1 ? matches[0][0] : null;
}

function buildAdapterOutput(record, images, nowIso) {
  const { countryCode } = record;
  const projectId = `project-mediaseed-${record.recordId}`;
  const institutionId = record.coordinator
    ? `institution-mediaseed-${slugify(record.coordinator)}`
    : `institution-mediaseed-${slugify(record.recordId)}-coordinator`;
  const sourceId = `source-mediaseed-${slugify(record.recordId)}`;
  const leadOrganisation = record.coordinator || record.sourceDatabase || "Unnamed coordinator";

  const combinedText = [record.title, record.summary, record.whyUseful, record.evidenceSnippet]
    .filter(Boolean)
    .join(" ");
  const categories = classifyText(combinedText);
  const technologies = detectTechnologies(combinedText);

  // sourcePages[].images[] is what CountryProfilePanel, ProjectDetail and
  // ResearchRecordRow already render as linked preview cards with a "rights
  // not verified" note - this is the one place image candidates flow into.
  // Excludes anything a prior curate:images run already marked unsuitable
  // (see aiCuration/verdict.mjs) - otherwise re-running this script would
  // silently resurrect images that were deliberately hidden.
  const sourcePageImages = images
    .filter((image) => !shouldHideImage(image.aiCuration))
    .map((image) => ({
      imageUrl: image.imageUrl,
      altText: image.altText,
      caption: image.caption,
      sourceUrl: image.sourceUrl,
      canEmbed: false,
      rightsNote: image.rightsNote,
    }));

  return {
    project: {
      id: projectId,
      slug: slugify(`${record.title}-${countryCode}`),
      title: record.title,
      alternateTitles: record.acronym ? [record.acronym] : [],
      summary: firstSentence(record.summary, record.title),
      technicalDescription: record.evidenceSnippet || record.summary,
      projectType: "MEDIA_SEED_RECORD",
      entityType: "PROJECT",
      status: "Active project",
      projectStatus: "Active project",
      startDate: "",
      endDate: "",
      categories,
      researchCategories: categories,
      technologies,
      keyTechnologies: technologies,
      fundingAmount: null,
      fundingCurrency: "",
      leadInstitutionId: institutionId,
      leadOrganisation,
      partnerOrganisations: [],
      countryCode,
      country: countryCode,
      city: "",
      latitude: null,
      longitude: null,
      locationPrecision: "institution-country",
      locationConfidence: 70,
      sourceConfidence: 80,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastVerifiedAt: record.extractedAt || nowIso,
      lastUpdatedAt: nowIso,
      plainLanguageSummary: firstSentence(record.whyUseful || record.summary, record.summary),
      problemAddressed: "",
      proposedSolution: "",
      expectedImpact: "",
      milestones: [
        {
          date: record.extractedAt || nowIso,
          label: "Media-enriched seed record imported",
          status: "verified",
          sourceIds: [sourceId],
        },
      ],
      researchOutputs: [],
      // Deliberately empty: we have no confirmed image licence for a hero
      // image (do not claim image rights), so enrichProject's existing
      // "no verified project image" placeholder applies automatically.
      images: [],
      sourceIds: [sourceId],
      fieldSources: {
        title: [sourceId],
        leadOrganisation: [sourceId],
        researchCategories: [sourceId],
        country: [sourceId],
      },
      displayReasons: ["matches_research_category", "primary_source_available"],
      extractionMethod: "Media-enriched seed import (CORDIS project pages)",
      openAlex: null,
      ...emptyAiFields(),
      sourcePages: [
        {
          sourceId: `sourcepage-${projectId}`,
          sourceType: "media-seed",
          sourceName: record.sourceDatabase || "CORDIS",
          sourceUrl: record.sourceUrl,
          pageTitle: record.title,
          publishedDate: record.extractedAt || nowIso,
          fetchedAt: record.extractedAt || nowIso,
          rawTextStored: false,
          cleanedTextSummary: record.summary,
          chunks: [
            {
              chunkId: `chunk-mediaseed-${slugify(record.recordId)}-0`,
              text: record.evidenceSnippet || record.summary,
              heading: "",
              sourceUrl: record.sourceUrl,
              pageTitle: record.title,
            },
          ],
          images: sourcePageImages,
        },
      ],
      dataQuality: {
        hasOriginalSource: true,
        hasOfficialSource: record.sourceQuality === "official_project_page",
        evidenceCount: record.evidenceSnippet ? 1 : 0,
        imageCandidateCount: sourcePageImages.length,
        needsManualReview: false,
        lastAnalysedAt: null,
      },
    },
    institution: {
      id: institutionId,
      rorId: "",
      canonicalName: leadOrganisation,
      aliases: [],
      institutionType: "unspecified",
      countryCode,
      city: "",
      latitude: null,
      longitude: null,
      website: "",
      sourceIds: [sourceId],
    },
    source: {
      id: sourceId,
      publisher: record.sourceDatabase || "CORDIS",
      title: record.title,
      url: record.sourceUrl,
      sourceType: "media-seed",
      authorityLevel: record.sourceQuality === "official_project_page" ? "A" : "B",
      primaryOrSecondary: "primary",
      publicationDate: record.extractedAt || nowIso,
      retrievedAt: nowIso,
      contentHash: hashContent(record.sourceUrl + record.summary),
      licence: "Source metadata only; image rights not verified",
      extractionMethod: "Media-enriched seed import",
      supportedProjectFields: ["title", "leadOrganisation", "researchCategories", "country"],
      reliabilityScore: record.sourceQuality === "official_project_page" ? 85 : 70,
    },
    relationship: {
      id: `rel-institution-${institutionId}-${projectId}`,
      sourceEntityType: "INSTITUTION",
      sourceEntityId: institutionId,
      targetEntityType: "PROJECT",
      targetEntityId: projectId,
      relationType: "LEAD_INSTITUTION_COUNTRY",
      evidenceSourceIds: [sourceId],
      confidence: 78,
      firstObservedAt: nowIso,
      lastVerifiedAt: record.extractedAt || nowIso,
      explanationData: {
        role: "Lead institution",
        text: `${leadOrganisation} is related because this record's source page names it as the coordinator for ${record.title}.`,
      },
    },
  };
}

async function readPreviousDataset() {
  try {
    const raw = await fs.readFile(generatedPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function main() {
  const nowIso = new Date().toISOString();

  const seedRaw = await fs.readFile(path.join(seedDir, RECORDS_SEED_FILE), "utf8");
  const seed = JSON.parse(seedRaw);

  const csvRaw = await fs.readFile(path.join(seedDir, IMAGES_CSV_FILE), "utf8");
  const csvRows = parseCsv(csvRaw);
  if (csvRows.length !== seed.image_candidate_count) {
    console.warn(
      `⚠ CSV row count (${csvRows.length}) does not match JSON image_candidate_count (${seed.image_candidate_count}) - both files were provided as inputs, cross-check failed.`
    );
  }

  const researchRecords = [];
  const imageCandidates = [];

  seed.records.forEach((record) => {
    const countryCode = deriveCountryCode(record.country_or_region, record.coordinator);

    const recordImageObjects = (record.images ?? []).map((image, index) => {
      const imageId = `${record.record_id}-img-${index + 1}`;
      const imageCandidate = {
        imageId,
        recordId: record.record_id,
        imageUrl: image.imageUrl,
        caption: image.caption ?? "",
        altText: image.altText ?? "",
        sourceUrl: image.sourceUrl,
        sourceName: image.sourceName ?? "",
        imageType: image.imageType ?? "unspecified",
        // Never trust an upstream true here - canEmbed stays false by
        // default regardless of what the seed file says, per the image
        // rules (no rights have been confirmed for any of these).
        canEmbed: false,
        rightsNote:
          image.rightsNote ?? "Rights not verified; do not claim as cleared for reuse.",
        // Tags provenance so this script can tell its own seed-derived
        // entries apart from ones another script (e.g. enrichTestMedia.mjs)
        // added directly to image-candidates.json - see the merge logic
        // below, which must not delete those on a re-run.
        origin: "media-seed",
      };
      imageCandidates.push(imageCandidate);
      return imageCandidate;
    });
    const recordImageIds = recordImageObjects.map((image) => image.imageId);

    // Every field below is passed straight to normalizeResearchRecord() so
    // this is the ONE place a media-seed record's shape is decided - see
    // scripts/processing/normalizeResearchRecord.mjs for what happens to
    // each field (e.g. sourceUrl -> sourceUrls[], verificationStatus is
    // computed from real evidence, never left unset).
    researchRecords.push(
      normalizeResearchRecord(
        {
          recordId: record.record_id,
          recordType: "funded_project",
          title: record.title,
          acronym: record.acronym ?? "",
          sourceDatabase: record.source_database ?? "",
          sourceUrl: record.source_url,
          sourceType: record.source_type ?? "",
          topicPrimary: record.topic_primary ?? "",
          topicSecondary: record.topic_secondary ?? "",
          countryOrRegion: record.country_or_region ?? "",
          countryCode,
          coordinator: record.coordinator ?? "",
          summary: record.summary ?? "",
          whyUseful: record.why_useful ?? "",
          evidenceSnippet: record.evidence_snippet ?? "",
          recencyCategory: record.recency_category ?? "",
          actionabilityScore: record.actionability_score ?? null,
          relevanceScore: record.relevance_score ?? null,
          sourceQuality: record.source_quality ?? "",
          followUpStatus: record.follow_up_status ?? "",
          dataStatus: record.data_status ?? "",
          hasImageCandidates: Boolean(record.has_image_candidates),
          imageCandidateCount: record.image_candidate_count ?? recordImageObjects.length,
          imageIds: recordImageIds,
          images: recordImageObjects,
          extractedAt: record.extracted_at ?? nowIso,
        },
        { nowIso }
      )
    );
  });

  await fs.mkdir(processedDir, { recursive: true });

  const recordsOutput = {
    generatedAt: nowIso,
    sourceSeedFile: RECORDS_SEED_FILE,
    recordCount: researchRecords.length,
    recordsWithImageCandidates: researchRecords.filter((r) => r.imageIds.length > 0).length,
    countryAttributedCount: researchRecords.filter((r) => r.countryCode).length,
    records: researchRecords,
  };
  await fs.writeFile(
    path.join(processedDir, "research-records.json"),
    `${JSON.stringify(recordsOutput, null, 2)}\n`
  );

  // Preserve any AI curation verdicts (see curateImages.mjs) already
  // recorded against these same imageIds - this script rebuilds the whole
  // file from the seed every run, and must not silently wipe out curation
  // work just because the seed was re-ingested. imageId is deterministic
  // from the seed data, so it matches stably across runs.
  //
  // Also preserves any image candidates a DIFFERENT script (e.g.
  // enrichTestMedia.mjs, tagged origin !== "media-seed") already added to
  // this same file - otherwise re-running the seed import would silently
  // delete real, live-fetched images that this script knows nothing about.
  let previousAiCurationByImageId = new Map();
  let preservedNonSeedImages = [];
  try {
    const previous = JSON.parse(
      await fs.readFile(path.join(processedDir, "image-candidates.json"), "utf8")
    );
    previousAiCurationByImageId = new Map(
      (previous.images ?? [])
        .filter((image) => image.aiCuration)
        .map((image) => [image.imageId, image.aiCuration])
    );
    preservedNonSeedImages = (previous.images ?? []).filter(
      (image) => image.origin && image.origin !== "media-seed"
    );
  } catch {
    // No previous file yet - nothing to preserve.
  }
  imageCandidates.forEach((image) => {
    const previousCuration = previousAiCurationByImageId.get(image.imageId);
    if (previousCuration) {
      image.aiCuration = previousCuration;
    }
  });

  const allImages = [...imageCandidates, ...preservedNonSeedImages];
  const imagesOutput = {
    generatedAt: nowIso,
    sourceSeedFile: RECORDS_SEED_FILE,
    imageCandidateCount: allImages.length,
    images: allImages,
  };
  await fs.writeFile(
    path.join(processedDir, "image-candidates.json"),
    `${JSON.stringify(imagesOutput, null, 2)}\n`
  );

  // ---- Feed the country-attributable subset into the live app dataset ----
  // Uses allImages (seed-derived + preserved non-seed) so re-running this
  // script after enrichTestMedia.mjs doesn't drop live-fetched images from
  // the embedded sourcePages either.
  const imagesByRecordId = new Map();
  allImages.forEach((image) => {
    if (!imagesByRecordId.has(image.recordId)) imagesByRecordId.set(image.recordId, []);
    imagesByRecordId.get(image.recordId).push(image);
  });

  const attributedRecords = researchRecords.filter((r) => r.countryCode);
  const mediaSeedOutputs = attributedRecords.map((record) =>
    buildAdapterOutput(record, imagesByRecordId.get(record.recordId) ?? [], nowIso)
  );

  const previous = await readPreviousDataset();
  const currentMediaSeedIds = new Set(mediaSeedOutputs.map((output) => output.project.id));
  const carriedForwardProjects = (previous?.projects ?? []).filter(
    (project) => !project.id.startsWith("project-mediaseed-") || currentMediaSeedIds.has(project.id)
  );
  const previousAsAdapterOutput = previous
    ? {
        projects: carriedForwardProjects,
        institutions: previous.institutions ?? [],
        sources: previous.sources ?? [],
        relationships: previous.relationships ?? [],
      }
    : null;

  const mediaSeedRun = {
    id: `run-media-seed-${Date.now()}`,
    sourceId: "media-seed",
    sourceName: "Media-Enabled Seed Dataset",
    extractionMethod: "manual seed import (media-enriched)",
    startedAt: nowIso,
    completedAt: nowIso,
    status: "success",
    recordsFetched: researchRecords.length,
    recordsCreated: mediaSeedOutputs.length,
    recordsUpdated: 0,
    recordsRejected: researchRecords.length - mediaSeedOutputs.length,
    parseErrors: [],
    rateLimitStatus: "not-applicable",
  };
  const mediaSeedStatus = {
    sourceId: "media-seed",
    sourceName: "Media-Enabled Seed Dataset",
    extractionType: "manual seed import (media-enriched)",
    lastAttemptedSync: nowIso,
    lastSuccessfulSync: nowIso,
    recordsFetched: researchRecords.length,
    recordsCreated: mediaSeedOutputs.length,
    recordsUpdated: 0,
    recordsRejected: researchRecords.length - mediaSeedOutputs.length,
    parseErrors: [],
    rateLimitStatus: "not-applicable",
    nextScheduledRun: "",
  };

  const dataset = buildDataset({
    adapterOutputs: [
      ...(previousAsAdapterOutput ? [previousAsAdapterOutput] : []),
      ...mediaSeedOutputs,
    ],
    extractionRuns: [mediaSeedRun, ...(previous?.extractionRuns ?? [])].slice(0, 40),
    nowIso,
    sourceStatus: [
      ...(previous?.meta?.sourceStatus ?? []).filter((s) => s.sourceId !== "media-seed"),
      mediaSeedStatus,
    ],
  });

  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  await fs.writeFile(generatedPath, `${JSON.stringify(dataset, null, 2)}\n`);

  const verificationStatusCounts = researchRecords.reduce((counts, record) => {
    counts[record.verificationStatus] = (counts[record.verificationStatus] ?? 0) + 1;
    return counts;
  }, {});

  console.log("\n" + "=".repeat(60));
  console.log("📦 Media Seed Ingestion Summary");
  console.log("=".repeat(60));
  console.log(`Records read from seed:         ${researchRecords.length}`);
  console.log(`Records with image candidates:  ${recordsOutput.recordsWithImageCandidates}`);
  console.log(`Image candidates total:         ${imageCandidates.length}`);
  console.log(
    `Verification status breakdown:  ${Object.entries(verificationStatusCounts)
      .map(([status, count]) => `${status}=${count}`)
      .join(", ")}`
  );
  console.log(`Records attributed to a country: ${attributedRecords.length} (${attributedRecords.map((r) => r.countryCode).join(", ")})`);
  console.log(`  -> ${researchRecords.length - attributedRecords.length} records are real "EU / multi-country consortium" entries with no single named coordinator country - kept in the processed files, NOT forced onto a country pin.`);
  console.log(`Processed files written:`);
  console.log(`  - data/processed/research-records.json`);
  console.log(`  - data/processed/image-candidates.json`);
  console.log(`Generated dataset updated: src/data/generated/liveResearchData.json`);
  console.log(`  -> ${dataset.publicProjects.length} public projects, ${dataset.countries.length} countries total`);
  console.log("=".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("Fatal error during media seed ingestion:", error);
  process.exitCode = 1;
});
