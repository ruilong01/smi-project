import { MARITIME_QUERIES } from "../config.mjs";
import { fetchJson } from "../http.mjs";
import {
  classifyText,
  detectTechnologies,
  firstSentence,
  hashContent,
  isStrongMaritimeMatch,
  slugify,
} from "../normalization.mjs";

function getPublicationDate(work) {
  return (
    work.publication_date ||
    [work.publication_year, "01", "01"].filter(Boolean).join("-")
  );
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

export async function fetchOpenAlexRecords() {
  const records = [];

  for (const query of MARITIME_QUERIES) {
    const url = new URL("https://api.openalex.org/works");
    url.searchParams.set("search", query);
    url.searchParams.set("per-page", "8");
    url.searchParams.set("filter", "from_publication_date:2023-01-01");
    url.searchParams.set("mailto", "research-demo@example.invalid");

    const payload = await fetchJson(url);
    records.push(
      ...payload.results.map((record) => ({
        query,
        record,
      }))
    );
  }

  return records;
}

export function normalizeOpenAlexRecord(rawRecord, nowIso) {
  const work = rawRecord.record;
  const title = work.title || work.display_name;
  const abstract =
    work.abstract ||
    work.primary_location?.source?.display_name ||
    work.concepts?.map((concept) => concept.display_name).join(", ");
  const text = `${title} ${abstract ?? ""}`;

  if (!title || !isStrongMaritimeMatch(text)) {
    return null;
  }

  const institutions = getInstitutions(work);
  const leadInstitution = institutions[0];
  const countryCode = leadInstitution?.country_code;
  if (!countryCode) {
    return null;
  }

  const categories = classifyText(text);
  const technologies = detectTechnologies(text);
  const publicationDate = getPublicationDate(work);
  const doi = work.doi?.replace("https://doi.org/", "");
  const sourceId = `source-openalex-${slugify(work.id)}`;
  const projectId = `project-openalex-${slugify(work.id)}`;

  return {
    rawId: work.id,
    project: {
      id: projectId,
      slug: slugify(`${title}-${countryCode}`),
      title,
      alternateTitles: [],
      summary: firstSentence(
        abstract,
        `Publication-backed maritime R&D record from OpenAlex for ${title}.`
      ),
      technicalDescription: firstSentence(
        text,
        "Technical description is limited to source metadata in this extracted record."
      ),
      projectType: "RESEARCH_PAPER",
      entityType: "RESEARCH_PAPER",
      status: "Publication record",
      projectStatus: "Publication record",
      startDate: publicationDate,
      endDate: "",
      categories,
      researchCategories: categories,
      technologies,
      keyTechnologies: technologies,
      fundingAmount: null,
      fundingCurrency: "",
      leadInstitutionId: leadInstitution.id,
      leadOrganisation: leadInstitution.display_name,
      partnerOrganisations: institutions.slice(1, 5).map((institution) => institution.display_name),
      countryCode,
      country: countryCode,
      city: "",
      latitude: null,
      longitude: null,
      locationPrecision: "institution-country",
      locationConfidence: 72,
      sourceConfidence: 78,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastVerifiedAt: nowIso,
      lastUpdatedAt: nowIso,
      plainLanguageSummary: firstSentence(
        abstract,
        `This publication is included because its metadata links maritime terms with ${categories.join(", ")}.`
      ),
      problemAddressed: "",
      proposedSolution: "",
      expectedImpact: "",
      milestones: [
        {
          date: publicationDate,
          label: "Publication metadata retrieved from OpenAlex",
          status: "verified",
          sourceIds: [sourceId],
        },
      ],
      researchOutputs: [
        {
          type: "Publication",
          title,
          date: publicationDate,
          sourceIds: [sourceId],
          doi,
        },
      ],
      images: [],
      sourceIds: [sourceId],
      fieldSources: {
        title: [sourceId],
        leadOrganisation: [sourceId],
        researchCategories: [sourceId],
        researchOutputs: [sourceId],
        country: [sourceId],
      },
      displayReasons: [
        "matches_research_category",
        "updated_within_36_months",
        "primary_source_available",
      ],
      extractionMethod: "OpenAlex API",
      doi,
    },
    institutions: institutions.map((institution) => ({
      id: institution.id,
      rorId: institution.ror,
      canonicalName: institution.display_name,
      aliases: [],
      institutionType: "research-institution",
      countryCode: institution.country_code,
      city: "",
      latitude: null,
      longitude: null,
      website: "",
      sourceIds: [sourceId],
    })),
    source: {
      id: sourceId,
      publisher: "OpenAlex",
      title: `OpenAlex metadata for ${title}`,
      url: work.id,
      sourceType: "api",
      authorityLevel: "C",
      primaryOrSecondary: "secondary",
      publicationDate,
      retrievedAt: nowIso,
      contentHash: hashContent(JSON.stringify(work)),
      licence: "OpenAlex metadata",
      extractionMethod: "OpenAlex API",
      supportedProjectFields: [
        "title",
        "leadOrganisation",
        "researchCategories",
        "researchOutputs",
        "country",
      ],
      reliabilityScore: 78,
    },
    relationships: institutions.map((institution, index) => ({
      id: `rel-${projectId}-${slugify(institution.id)}`,
      sourceEntityType: "INSTITUTION",
      sourceEntityId: institution.id,
      targetEntityType: "PROJECT",
      targetEntityId: projectId,
      relationType: index === 0 ? "PUBLICATION_AFFILIATION" : "PUBLICATION_AFFILIATION",
      evidenceSourceIds: [sourceId],
      confidence: index === 0 ? 78 : 68,
      firstObservedAt: nowIso,
      lastVerifiedAt: nowIso,
      explanationData: {
        role: index === 0 ? "Lead publication affiliation" : "Publication affiliation",
        text: `${institution.display_name} is related because OpenAlex lists it in the publication affiliations for this maritime research output.`,
      },
    })),
  };
}
