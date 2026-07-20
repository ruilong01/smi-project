import { COUNTRY_ATLAS_NAMES } from "../config.mjs";
import { hashContent, slugify } from "../normalization.mjs";
import { emptyAiFields } from "../enrichment/schemaDefaults.mjs";
import { manualSources } from "../manualSources.mjs";

const AUTHORITY_LEVELS = new Set(["A", "B", "C", "D", "E", "F"]);

function isValidExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function validateEntry(entry, index) {
  const problems = [];
  if (!entry.title) problems.push("missing title");
  if (!entry.countryCode || !COUNTRY_ATLAS_NAMES[entry.countryCode]) {
    problems.push(`countryCode "${entry.countryCode}" is not a supported ISO code`);
  }
  if (!entry.leadOrganisation) problems.push("missing leadOrganisation");
  if (!entry.summary) problems.push("missing summary");
  if (!Array.isArray(entry.categories) || entry.categories.length === 0) {
    problems.push("missing categories");
  }
  if (!entry.sourceUrl || !isValidExternalUrl(entry.sourceUrl)) {
    problems.push(`sourceUrl "${entry.sourceUrl}" is missing or not a valid http(s) URL`);
  }
  if (!entry.sourceName) problems.push("missing sourceName");
  if (!entry.sourceDate || Number.isNaN(Date.parse(entry.sourceDate))) {
    problems.push(`sourceDate "${entry.sourceDate}" is missing or not a valid date`);
  }

  if (problems.length) {
    throw new Error(`manualSources[${index}] ("${entry.title ?? "untitled"}"): ${problems.join("; ")}`);
  }
}

/**
 * Normalizes hand-curated entries from manualSources.mjs into the same
 * {project, institution, source, relationship} shape every other adapter
 * produces. No fetching happens here — a human already read the source and
 * wrote the summary; this just validates and structures it. One bad entry
 * is skipped (logged), it never stops the rest from loading.
 */
export function fetchManualRecords(nowIso) {
  const records = [];

  manualSources.forEach((entry, index) => {
    try {
      validateEntry(entry, index);

      const sourceId = `source-manual-${slugify(entry.sourceUrl)}`;
      const projectId = `project-manual-${slugify(entry.title)}`;
      const institutionId = `institution-manual-${slugify(entry.leadOrganisation)}`;
      const authorityLevel = AUTHORITY_LEVELS.has(entry.authorityLevel)
        ? entry.authorityLevel
        : "B";

      records.push({
        project: {
          id: projectId,
          slug: slugify(`${entry.title}-${entry.countryCode}`),
          title: entry.title,
          alternateTitles: [],
          summary: entry.summary,
          technicalDescription: entry.summary,
          projectType: "MANUAL_RECORD",
          entityType: "PROJECT",
          status: entry.projectStatus ?? "Active project",
          projectStatus: entry.projectStatus ?? "Active project",
          startDate: entry.startDate ?? "",
          endDate: "",
          categories: entry.categories,
          researchCategories: entry.categories,
          technologies: entry.technologies ?? [],
          keyTechnologies: entry.technologies ?? [],
          fundingAmount: null,
          fundingCurrency: "",
          leadInstitutionId: institutionId,
          leadOrganisation: entry.leadOrganisation,
          partnerOrganisations: entry.partnerOrganisations ?? [],
          countryCode: entry.countryCode,
          country: entry.countryCode,
          city: entry.city ?? "",
          latitude: null,
          longitude: null,
          locationPrecision: "institution-country",
          locationConfidence: 80,
          sourceConfidence: 85,
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          lastVerifiedAt: entry.sourceDate,
          lastUpdatedAt: nowIso,
          plainLanguageSummary: entry.summary,
          problemAddressed: "",
          proposedSolution: "",
          expectedImpact: "",
          milestones: [
            {
              date: entry.sourceDate,
              label: "Manually verified from source",
              status: "verified",
              sourceIds: [sourceId],
            },
          ],
          researchOutputs: [],
          images: [],
          sourceIds: [sourceId],
          fieldSources: {
            title: [sourceId],
            leadOrganisation: [sourceId],
            researchCategories: [sourceId],
            country: [sourceId],
          },
          displayReasons: [
            "matches_research_category",
            "primary_source_available",
          ],
          extractionMethod: "Manual curation (human-verified)",
          openAlex: null,
          ...emptyAiFields(),
          sourcePages: [
            {
              sourceId: `sourcepage-${projectId}`,
              sourceType: "manual",
              sourceName: entry.sourceName,
              sourceUrl: entry.sourceUrl,
              pageTitle: entry.sourceName,
              publishedDate: entry.sourceDate,
              fetchedAt: nowIso,
              rawTextStored: false,
              cleanedTextSummary: entry.summary,
              chunks: [
                {
                  chunkId: `chunk-manual-${slugify(entry.sourceUrl)}-0`,
                  text: entry.summary,
                  heading: "",
                  sourceUrl: entry.sourceUrl,
                  pageTitle: entry.sourceName,
                },
              ],
              images: [],
            },
          ],
          dataQuality: {
            hasOriginalSource: true,
            hasOfficialSource: authorityLevel === "A",
            evidenceCount: 0,
            imageCandidateCount: 0,
            needsManualReview: false,
            lastAnalysedAt: null,
          },
        },
        institution: {
          id: institutionId,
          rorId: "",
          canonicalName: entry.leadOrganisation,
          aliases: [],
          institutionType: "unspecified",
          countryCode: entry.countryCode,
          city: entry.city ?? "",
          latitude: null,
          longitude: null,
          website: "",
          sourceIds: [sourceId],
        },
        source: {
          id: sourceId,
          publisher: entry.sourceName,
          title: entry.title,
          url: entry.sourceUrl,
          sourceType: "manual",
          authorityLevel,
          primaryOrSecondary: "primary",
          publicationDate: entry.sourceDate,
          retrievedAt: nowIso,
          contentHash: hashContent(entry.sourceUrl + entry.summary),
          licence: "Manually verified; rights not assumed",
          extractionMethod: "Manual curation (human-verified)",
          supportedProjectFields: [
            "title",
            "leadOrganisation",
            "researchCategories",
            "country",
          ],
          reliabilityScore: 85,
        },
        relationship: {
          id: `rel-institution-${institutionId}-${projectId}`,
          sourceEntityType: "INSTITUTION",
          sourceEntityId: institutionId,
          targetEntityType: "PROJECT",
          targetEntityId: projectId,
          relationType: "LEAD_INSTITUTION_COUNTRY",
          evidenceSourceIds: [sourceId],
          confidence: 85,
          firstObservedAt: nowIso,
          lastVerifiedAt: entry.sourceDate,
          explanationData: {
            role: "Lead institution",
            text: `${entry.leadOrganisation} is related because this record was manually curated and verified against ${entry.sourceName}.`,
          },
        },
      });
    } catch (error) {
      console.warn(`  ✗ Skipping manual entry: ${error.message}`);
    }
  });

  return records;
}
