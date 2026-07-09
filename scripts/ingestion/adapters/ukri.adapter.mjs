import { MARITIME_QUERIES } from "../config.mjs";
import { fetchJson, delayMs } from "../http.mjs";
import {
  classifyText,
  detectTechnologies,
  firstSentence,
  hashContent,
  isStrongMaritimeMatch,
  slugify,
} from "../normalization.mjs";

const API_URL = "https://gtr.ukri.org/api/search/project";
const REQUEST_DELAY_MS = 800;
const MAX_RECORDS_PER_QUERY = 6;

function fromEpochMs(value) {
  if (!value) {
    return "";
  }

  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
}

function getProjectComposition(result) {
  return result?.projectComposition ?? {};
}

function normalizeUkriResult(result, query, nowIso) {
  const composition = getProjectComposition(result);
  const project = composition.project;

  if (!project?.id || !project?.title) {
    return null;
  }

  const leadOrganisation = composition.leadResearchOrganisation;
  const abstractText = project.abstractText ?? result.abstractSnippet ?? "";
  const impactText = project.potentialImpactText ?? "";
  const searchableText = [
    project.title,
    abstractText,
    impactText,
    project.grantCategory,
    leadOrganisation?.name,
  ].join(" ");

  if (!isStrongMaritimeMatch(searchableText)) {
    return null;
  }

  const categories = classifyText(`${searchableText} ${query}`);
  if (!categories.length) {
    return null;
  }

  const sourceId = `source-ukri-${slugify(project.grantReference || project.id)}`;
  const projectId = `project-ukri-${slugify(project.grantReference || project.id)}`;
  const institutionId = `institution-ukri-${slugify(leadOrganisation?.id || leadOrganisation?.name || "unknown")}`;
  const startDate = fromEpochMs(project.fund?.start);
  const endDate = fromEpochMs(project.fund?.end);
  const projectUrl = `https://gtr.ukri.org/projects?ref=${encodeURIComponent(project.grantReference ?? project.id)}`;
  const summary = firstSentence(
    abstractText || impactText,
    `UKRI funded project metadata links this record to ${categories.join(", ")}.`
  );

  return {
    project: {
      id: projectId,
      slug: slugify(project.title),
      title: project.title,
      alternateTitles: [],
      summary,
      technicalDescription: firstSentence(
        [abstractText, impactText].filter(Boolean).join(" "),
        "Technical description is limited to UKRI Gateway to Research metadata."
      ),
      projectType: "FUNDED_RESEARCH_PROJECT",
      entityType: "FUNDED_RESEARCH_PROJECT",
      status: project.status ?? "Funded research project",
      projectStatus: project.status ?? "Funded research project",
      startDate,
      endDate,
      categories,
      researchCategories: categories,
      technologies: detectTechnologies(searchableText),
      keyTechnologies: detectTechnologies(searchableText),
      fundingAmount: project.fund?.valuePounds ?? null,
      fundingCurrency: project.fund?.valuePounds ? "GBP" : "",
      fundingInformation: project.fund?.valuePounds
        ? `GBP ${project.fund.valuePounds.toLocaleString()} from ${project.fund.funder?.name ?? "UKRI"}`
        : project.fund?.funder?.name ?? "UKRI funding record",
      leadInstitutionId: institutionId,
      leadOrganisation: leadOrganisation?.name ?? "UKRI-funded organisation",
      partnerOrganisations: [],
      countryCode: "GB",
      country: "United Kingdom",
      city: "",
      latitude: 55.3781,
      longitude: -3.436,
      locationPrecision: "funder-country",
      locationConfidence: 70,
      sourceConfidence: 86,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastVerifiedAt: nowIso,
      lastUpdatedAt: nowIso,
      plainLanguageSummary: summary,
      problemAddressed: firstSentence(impactText, ""),
      proposedSolution: "",
      expectedImpact: firstSentence(impactText, ""),
      milestones: [
        {
          label: "Project start",
          date: startDate,
          status: "verified",
          sourceIds: [sourceId],
        },
        {
          label: "Project end",
          date: endDate,
          status: "planned",
          sourceIds: [sourceId],
        },
      ].filter((item) => item.date),
      researchOutputs: [],
      images: [],
      sourceIds: [sourceId],
      fieldSources: {
        title: [sourceId],
        country: [sourceId],
        leadOrganisation: [sourceId],
        researchCategories: [sourceId],
        fundingInformation: [sourceId],
      },
      displayReasons: [
        "official_source_confirmation",
        "matches_research_category",
        "primary_source_available",
      ],
      extractionMethod: "UKRI Gateway to Research API",
      sourceRecordId: project.id,
    },
    institution: {
      id: institutionId,
      canonicalName: leadOrganisation?.name ?? "UKRI-funded organisation",
      countryCode: "GB",
      city: "",
      latitude: 55.3781,
      longitude: -3.436,
      website: leadOrganisation?.website ?? "",
      sourceIds: [sourceId],
    },
    source: {
      id: sourceId,
      publisher: "UKRI Gateway to Research",
      title: `UKRI Gateway to Research metadata for ${project.title}`,
      url: projectUrl,
      sourceType: "api",
      authorityLevel: "B",
      primaryOrSecondary: "primary",
      publicationDate: startDate,
      retrievedAt: nowIso,
      contentHash: hashContent(JSON.stringify(project)),
      licence: "UK Open Government Licence metadata",
      extractionMethod: "UKRI Gateway to Research API",
      supportedProjectFields: [
        "title",
        "leadOrganisation",
        "country",
        "researchCategories",
        "fundingInformation",
      ],
      reliabilityScore: 86,
    },
    relationships: [
      {
        id: `rel-country-GB-${projectId}-ukri-funding`,
        sourceEntityType: "COUNTRY",
        sourceEntityId: "GB",
        targetEntityType: "PROJECT",
        targetEntityId: projectId,
        relationType: "FUNDER_COUNTRY",
        evidenceSourceIds: [sourceId],
        confidence: 82,
        firstObservedAt: nowIso,
        lastVerifiedAt: nowIso,
        explanationData: {
          role: "UK funded research",
          text: "The United Kingdom is related because UKRI Gateway to Research records this maritime R&D project in UK public funding metadata.",
        },
      },
    ],
  };
}

async function fetchUkriQuery(query, nowIso) {
  const url = new URL(API_URL);
  url.searchParams.set("term", query);
  url.searchParams.set("fetchSize", String(MAX_RECORDS_PER_QUERY));
  url.searchParams.set("page", "1");

  const payload = await fetchJson(url.toString(), {
    fetchOptions: {
      email: "research-demo@example.invalid",
      retries: 4,
      timeout: 30000,
      requestDelay: REQUEST_DELAY_MS,
    },
  });

  const results = payload?.facetedSearchResultBean?.results ?? [];
  return results
    .map((result) => normalizeUkriResult(result, query, nowIso))
    .filter(Boolean);
}

export async function fetchUkriMaritimeRecords(nowIso) {
  const recordsById = new Map();

  for (const query of MARITIME_QUERIES) {
    console.log(`Fetching UKRI Gateway to Research for query: "${query}"`);
    const records = await fetchUkriQuery(query, nowIso);
    records.forEach((record) => {
      recordsById.set(record.project.id, record);
    });
    console.log(`  Got ${records.length} usable UKRI records`);
    await delayMs(REQUEST_DELAY_MS);
  }

  return [...recordsById.values()];
}
