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

const API_URL = "https://www.research.gov/awardapi-service/v1/awards.json";
const REQUEST_DELAY_MS = 900;
const MAX_RECORDS_PER_QUERY = 8;
const PRINT_FIELDS = [
  "id",
  "title",
  "awardeeName",
  "awardeeCity",
  "awardeeStateCode",
  "awardeeCountryCode",
  "perfCity",
  "perfStateCode",
  "perfCountryCode",
  "fundsObligatedAmt",
  "estimatedTotalAmt",
  "date",
  "startDate",
  "expDate",
  "abstractText",
  "pdPIName",
  "program",
  "fundProgramName",
].join(",");

function parseUsDate(value) {
  if (!value) {
    return "";
  }

  const [month, day, year] = value.split("/");
  if (!month || !day || !year) {
    return "";
  }

  return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeNsfAward(award, query, nowIso) {
  if (!award?.id || !award?.title) {
    return null;
  }

  const searchableText = [
    award.title,
    award.abstractText,
    award.program,
    award.fundProgramName,
    award.awardeeName,
  ].join(" ");

  if (!isStrongMaritimeMatch(searchableText)) {
    return null;
  }

  const categories = classifyText(`${searchableText} ${query}`);
  if (!categories.length) {
    return null;
  }

  const sourceId = `source-nsf-${slugify(award.id)}`;
  const projectId = `project-nsf-${slugify(award.id)}`;
  const institutionId = `institution-nsf-${slugify(award.awardeeName || "unknown")}`;
  const startDate = parseUsDate(award.startDate);
  const endDate = parseUsDate(award.expDate);
  const awardUrl = `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${encodeURIComponent(award.id)}`;
  const summary = firstSentence(
    award.abstractText,
    `NSF award metadata links this record to ${categories.join(", ")}.`
  );
  const fundingAmount = Number(award.fundsObligatedAmt || award.estimatedTotalAmt || 0) || null;

  return {
    project: {
      id: projectId,
      slug: slugify(award.title),
      title: award.title,
      alternateTitles: [],
      summary,
      technicalDescription: firstSentence(
        award.abstractText,
        "Technical description is limited to NSF award metadata."
      ),
      projectType: "FUNDED_RESEARCH_PROJECT",
      entityType: "FUNDED_RESEARCH_PROJECT",
      status: "NSF award",
      projectStatus: "NSF award",
      startDate,
      endDate,
      categories,
      researchCategories: categories,
      technologies: detectTechnologies(searchableText),
      keyTechnologies: detectTechnologies(searchableText),
      fundingAmount,
      fundingCurrency: fundingAmount ? "USD" : "",
      fundingInformation: fundingAmount
        ? `USD ${fundingAmount.toLocaleString()} from the U.S. National Science Foundation`
        : "U.S. National Science Foundation award",
      leadInstitutionId: institutionId,
      leadOrganisation: award.awardeeName ?? "NSF awardee",
      partnerOrganisations: [],
      countryCode: "US",
      country: "United States",
      city: award.perfCity ?? award.awardeeCity ?? "",
      latitude: 39.8283,
      longitude: -98.5795,
      locationPrecision: award.perfCity || award.awardeeCity ? "city" : "funder-country",
      locationConfidence: award.perfCity || award.awardeeCity ? 76 : 68,
      sourceConfidence: 88,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastVerifiedAt: nowIso,
      lastUpdatedAt: nowIso,
      plainLanguageSummary: summary,
      problemAddressed: firstSentence(award.abstractText, ""),
      proposedSolution: "",
      expectedImpact: "",
      milestones: [
        {
          label: "Award start",
          date: startDate,
          status: "verified",
          sourceIds: [sourceId],
        },
        {
          label: "Award end",
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
        city: [sourceId],
        leadOrganisation: [sourceId],
        researchCategories: [sourceId],
        fundingInformation: [sourceId],
      },
      displayReasons: [
        "official_source_confirmation",
        "matches_research_category",
        "primary_source_available",
      ],
      extractionMethod: "NSF Award Search API",
      sourceRecordId: award.id,
    },
    institution: {
      id: institutionId,
      canonicalName: award.awardeeName ?? "NSF awardee",
      countryCode: "US",
      city: award.awardeeCity ?? "",
      latitude: 39.8283,
      longitude: -98.5795,
      website: "",
      sourceIds: [sourceId],
    },
    source: {
      id: sourceId,
      publisher: "U.S. National Science Foundation",
      title: `NSF award metadata for ${award.title}`,
      url: awardUrl,
      sourceType: "api",
      authorityLevel: "B",
      primaryOrSecondary: "primary",
      publicationDate: parseUsDate(award.date) || startDate,
      retrievedAt: nowIso,
      contentHash: hashContent(JSON.stringify(award)),
      licence: "Public NSF award metadata",
      extractionMethod: "NSF Award Search API",
      supportedProjectFields: [
        "title",
        "leadOrganisation",
        "country",
        "city",
        "researchCategories",
        "fundingInformation",
      ],
      reliabilityScore: 88,
    },
    relationships: [
      {
        id: `rel-country-US-${projectId}-nsf-award`,
        sourceEntityType: "COUNTRY",
        sourceEntityId: "US",
        targetEntityType: "PROJECT",
        targetEntityId: projectId,
        relationType: "FUNDER_COUNTRY",
        evidenceSourceIds: [sourceId],
        confidence: 84,
        firstObservedAt: nowIso,
        lastVerifiedAt: nowIso,
        explanationData: {
          role: "U.S. funded research",
          text: "The United States is related because NSF Award Search records this maritime R&D project in U.S. public funding metadata.",
        },
      },
    ],
  };
}

async function fetchNsfQuery(query, nowIso) {
  const url = new URL(API_URL);
  url.searchParams.set("keyword", query);
  url.searchParams.set("rpp", String(MAX_RECORDS_PER_QUERY));
  url.searchParams.set("offset", "0");
  url.searchParams.set("printFields", PRINT_FIELDS);

  const payload = await fetchJson(url.toString(), {
    fetchOptions: {
      email: "research-demo@example.invalid",
      retries: 4,
      timeout: 30000,
      requestDelay: REQUEST_DELAY_MS,
    },
  });

  const awards = payload?.response?.award ?? [];
  return awards
    .map((award) => normalizeNsfAward(award, query, nowIso))
    .filter(Boolean);
}

export async function fetchNsfMaritimeRecords(nowIso) {
  const recordsById = new Map();

  for (const query of MARITIME_QUERIES) {
    console.log(`Fetching NSF Award Search for query: "${query}"`);
    const records = await fetchNsfQuery(query, nowIso);
    records.forEach((record) => {
      recordsById.set(record.project.id, record);
    });
    console.log(`  Got ${records.length} usable NSF records`);
    await delayMs(REQUEST_DELAY_MS);
  }

  return [...recordsById.values()];
}
