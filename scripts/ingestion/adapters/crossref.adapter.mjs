import { MARITIME_QUERIES } from "../config.mjs";
import { fetchJson, delayMs } from "../http.mjs";
import {
  detectTechnologies,
  firstSentence,
  hashContent,
  slugify,
} from "../normalization.mjs";

const API_URL = "https://api.crossref.org/works";
const CROSSREF_EMAIL = process.env.CROSSREF_MAILTO ?? "research-demo@example.invalid";
const DEFAULT_FROM_DATE = "2023-01-01";
const DEFAULT_ROWS = 20;
const MAX_RECORDS_PER_QUERY = 8;
const REQUEST_DELAY_MS = 800;

const CATEGORY_RULES = {
  "Alternative energy and fuels": [
    "green shipping",
    "shipping decarbonisation",
    "shipping decarbonization",
    "maritime decarbonisation",
    "maritime decarbonization",
    "zero emission shipping",
    "zero-emission shipping",
    "alternative marine fuel",
    "marine alternative fuel",
    "ammonia fuel",
    "methanol fuel",
    "hydrogen fuel",
    "marine biofuel",
    "marine biofuels",
    "lng fuel",
  ],
  "Vessel efficiency": [
    "vessel emissions",
    "ship emissions",
    "energy efficient ship",
    "energy-efficient ship",
    "ship electrification",
    "vessel electrification",
    "battery electric ship",
    "battery-electric ship",
  ],
  "Intelligent port services": [
    "smart port",
    "smart ports",
    "port automation",
    "automated terminal",
    "digital port",
    "intelligent port",
    "port digitalisation",
    "port digitalization",
  ],
  "Autonomous navigation": [
    "autonomous vessel",
    "autonomous vessels",
    "autonomous ship",
    "autonomous ships",
    "maritime autonomous surface ship",
    "unmanned surface vessel",
    "autonomous navigation",
    "autonomous docking",
  ],
  "Artificial intelligence": [
    "maritime artificial intelligence",
    "shipping artificial intelligence",
    "vessel artificial intelligence",
    "port artificial intelligence",
    "maritime machine learning",
    "ship machine learning",
    "vessel machine learning",
    "port machine learning",
    "maritime computer vision",
    "yolov8",
  ],
  "Maritime cybersecurity": [
    "maritime cybersecurity",
    "maritime cyber security",
    "ship cybersecurity",
    "ship cyber security",
    "vessel cybersecurity",
    "vessel cyber security",
    "port cybersecurity",
    "port cyber security",
  ],
  "Digital twins": [
    "maritime digital twin",
    "ship digital twin",
    "vessel digital twin",
    "port digital twin",
    "digital twin of a ship",
    "digital twin for ships",
  ],
};

const MARITIME_CONTEXT_TERMS = [
  "maritime",
  "marine",
  "shipping",
  "ship",
  "ships",
  "vessel",
  "vessels",
  "seaport",
  "port",
  "ports",
  "harbour",
  "harbor",
  "ocean transport",
  "sea transport",
  "autonomous surface vessel",
  "unmanned surface vessel",
];

const COUNTRY_HINTS = [
  ["SG", ["singapore", "maritime and port authority of singapore", "nus", "ntu singapore"]],
  ["CN", ["china", "p.r. china", "pr china", "people's republic of china", "beijing", "shanghai", "dalian", "chengdu", "wuhan"]],
  ["JP", ["japan", "tokyo", "yokohama", "osaka", "kobe"]],
  ["KR", ["south korea", "korea", "republic of korea", "busan", "seoul"]],
  ["NO", ["norway", "trondheim", "oslo", "norwegian"]],
  ["NL", ["netherlands", "dutch", "rotterdam", "elsevier bv"]],
  ["GB", ["united kingdom", "uk", "england", "scotland", "wales", "london", "southampton", "routledge", "taylor & francis"]],
  ["US", ["united states", "usa", "u.s.a", "california", "massachusetts", "ieee", "new york"]],
  ["DE", ["germany", "hamburg", "berlin", "springer"]],
  ["DK", ["denmark", "copenhagen", "danish"]],
  ["AU", ["australia", "sydney", "melbourne"]],
  ["CA", ["canada", "halifax", "vancouver"]],
  ["ID", ["indonesia", "jakarta", "surabaya", "jawa timur"]],
  ["IN", ["india", "mumbai", "chennai"]],
  ["IT", ["italy", "genoa", "rome"]],
  ["SE", ["sweden", "gothenburg", "malmo"]],
  ["PH", ["philippines", "manila"]],
];

function cleanText(value) {
  if (value == null) {
    return "";
  }

  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstText(value) {
  if (Array.isArray(value) && value.length > 0) {
    return cleanText(value[0]);
  }

  return cleanText(value);
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const output = [];

  values.forEach((rawValue) => {
    const value = cleanText(rawValue);
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      output.push(value);
    }
  });

  return output;
}

function phrasePresent(text, phrase) {
  const normalizedText = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalizedPhrase) {
    return false;
  }

  const pattern = new RegExp(
    `(^|[^a-z0-9])${normalizedPhrase.replace(/\s+/g, "\\s+")}([^a-z0-9]|$)`,
    "i"
  );
  return pattern.test(normalizedText);
}

function hasMaritimeContext(text) {
  return MARITIME_CONTEXT_TERMS.some((term) => phrasePresent(text, term));
}

function classifyCrossrefText(text) {
  if (!hasMaritimeContext(text)) {
    return [];
  }

  const categories = Object.entries(CATEGORY_RULES)
    .filter(([, phrases]) => phrases.some((phrase) => phrasePresent(text, phrase)))
    .map(([category]) => category);

  if (categories.length > 0) {
    return [...new Set(categories)];
  }

  return ["Safety and risk management"];
}

function getDate(item) {
  const candidates = [
    "published-online",
    "published-print",
    "published",
    "issued",
    "created",
  ];

  for (const key of candidates) {
    const parts = item[key]?.["date-parts"]?.[0];
    if (!Array.isArray(parts) || !parts.length) {
      continue;
    }

    const year = Number(parts[0]);
    const month = Number(parts[1] ?? 1);
    const day = Number(parts[2] ?? 1);

    if (Number.isFinite(year)) {
      return {
        publicationDate: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        year,
      };
    }
  }

  return { publicationDate: "", year: null };
}

function extractAuthorsAndAffiliations(item) {
  const authors = [];
  const affiliations = [];

  (item.author ?? []).forEach((author) => {
    const fullName = [cleanText(author.given), cleanText(author.family)]
      .filter(Boolean)
      .join(" ");
    if (fullName) {
      authors.push(fullName);
    }

    (author.affiliation ?? []).forEach((affiliation) => {
      const name = cleanText(affiliation?.name);
      if (name) {
        affiliations.push(name);
      }
    });
  });

  return {
    authors: uniqueNonEmpty(authors),
    affiliations: uniqueNonEmpty(affiliations),
  };
}

function extractFunders(item) {
  return uniqueNonEmpty(
    (item.funder ?? []).map((funder) => cleanText(funder?.name))
  );
}

function inferCountryCode(parts) {
  const haystack = parts.filter(Boolean).join(" ").toLowerCase();

  for (const [countryCode, hints] of COUNTRY_HINTS) {
    if (hints.some((hint) => haystack.includes(hint))) {
      return countryCode;
    }
  }

  return "";
}

function getRecordKey(item) {
  const doi = cleanText(item.DOI).toLowerCase();
  if (doi) {
    return `doi:${doi}`;
  }

  return `title:${firstText(item.title).toLowerCase()}`;
}

function buildCrossrefUrl({ query, cursor, rows }) {
  const url = new URL(API_URL);
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("filter", `from-pub-date:${DEFAULT_FROM_DATE}`);
  url.searchParams.set("rows", String(rows));
  url.searchParams.set("cursor", cursor);
  url.searchParams.set("mailto", CROSSREF_EMAIL);
  return url.toString();
}

async function fetchCrossrefQuery(query) {
  const recordsByKey = new Map();
  let cursor = "*";
  let page = 0;

  while (recordsByKey.size < MAX_RECORDS_PER_QUERY && page < 2) {
    page += 1;
    const rows = Math.min(DEFAULT_ROWS, MAX_RECORDS_PER_QUERY - recordsByKey.size);
    const payload = await fetchJson(buildCrossrefUrl({ query, cursor, rows }), {
      fetchOptions: {
        email: CROSSREF_EMAIL,
        retries: 4,
        timeout: 30000,
        requestDelay: REQUEST_DELAY_MS,
      },
    });

    const message = payload?.message;
    const items = Array.isArray(message?.items) ? message.items : [];
    if (!items.length) {
      break;
    }

    items.forEach((item) => {
      if (item && typeof item === "object") {
        recordsByKey.set(getRecordKey(item), { query, item });
      }
    });

    const nextCursor = message?.["next-cursor"];
    if (!nextCursor || nextCursor === cursor) {
      break;
    }

    cursor = nextCursor;
    if (recordsByKey.size < MAX_RECORDS_PER_QUERY) {
      await delayMs(REQUEST_DELAY_MS);
    }
  }

  return [...recordsByKey.values()];
}

function normalizeCrossrefRecord(rawRecord, nowIso) {
  const item = rawRecord.item;
  const title = firstText(item.title);
  const abstract = cleanText(item.abstract);
  const containerTitle = firstText(item["container-title"]);
  const subjects = uniqueNonEmpty(item.subject ?? []);
  const { authors, affiliations } = extractAuthorsAndAffiliations(item);
  const funders = extractFunders(item);
  const publisher = cleanText(item.publisher);
  const doi = cleanText(item.DOI);
  const url = cleanText(item.URL) || (doi ? `https://doi.org/${doi}` : "");
  const { publicationDate } = getDate(item);
  const searchableText = [
    title,
    abstract,
    containerTitle,
    subjects.join(" "),
    affiliations.join(" "),
    funders.join(" "),
    publisher,
  ].join(" ");
  const categories = classifyCrossrefText(searchableText);

  if (!title || categories.length === 0) {
    return null;
  }

  const countryCode = inferCountryCode([
    affiliations.join(" "),
    funders.join(" "),
    publisher,
    containerTitle,
    title,
  ]);

  if (!countryCode) {
    return null;
  }

  const sourceId = `source-crossref-${slugify(doi || title)}`;
  const projectId = `project-crossref-${slugify(doi || title)}`;
  const leadOrganisation =
    affiliations[0] ||
    funders[0] ||
    publisher ||
    "Crossref metadata source";
  const leadInstitutionId = `crossref-institution-${slugify(leadOrganisation)}-${countryCode.toLowerCase()}`;
  const technologies = detectTechnologies(searchableText);
  const summary = firstSentence(
    abstract || `${title}. ${containerTitle}`,
    `Crossref publication metadata links this record to ${categories.join(", ")}.`
  );

  return {
    rawId: doi || title,
    project: {
      id: projectId,
      slug: slugify(`${title}-${countryCode}`),
      title,
      alternateTitles: [],
      summary,
      technicalDescription: firstSentence(
        searchableText,
        "Technical description is limited to Crossref metadata for this extracted record."
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
      leadInstitutionId,
      leadOrganisation,
      partnerOrganisations: affiliations.slice(1, 5),
      countryCode,
      country: countryCode,
      city: "",
      latitude: null,
      longitude: null,
      locationPrecision: affiliations.length ? "affiliation-country" : "publisher-country",
      locationConfidence: affiliations.length ? 70 : 52,
      sourceConfidence: 80,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      lastVerifiedAt: nowIso,
      lastUpdatedAt: nowIso,
      plainLanguageSummary: summary,
      problemAddressed: "",
      proposedSolution: "",
      expectedImpact: "",
      milestones: [
        {
          date: publicationDate,
          label: "Publication metadata retrieved from Crossref",
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
      extractionMethod: "Crossref API direct search",
      doi,
    },
    institutions: [
      {
        id: leadInstitutionId,
        rorId: "",
        canonicalName: leadOrganisation,
        aliases: [],
        institutionType: affiliations.length ? "research-institution" : "publisher-or-metadata-location",
        countryCode,
        city: "",
        latitude: null,
        longitude: null,
        website: "",
        sourceIds: [sourceId],
      },
    ],
    source: {
      id: sourceId,
      publisher: "Crossref",
      title: `Crossref metadata for ${title}`,
      url,
      sourceType: "api",
      authorityLevel: "C",
      primaryOrSecondary: "secondary",
      publicationDate,
      retrievedAt: nowIso,
      contentHash: hashContent(JSON.stringify(item)),
      licence: item.license?.[0]?.URL ?? "Crossref metadata",
      extractionMethod: "Crossref API direct search",
      supportedProjectFields: [
        "title",
        "leadOrganisation",
        "researchCategories",
        "researchOutputs",
        "country",
      ],
      reliabilityScore: 80,
    },
    relationships: [
      {
        id: `rel-${projectId}-${leadInstitutionId}`,
        sourceEntityType: "INSTITUTION",
        sourceEntityId: leadInstitutionId,
        targetEntityType: "PROJECT",
        targetEntityId: projectId,
        relationType: affiliations.length ? "PUBLICATION_AFFILIATION" : "PUBLICATION_METADATA_SOURCE",
        evidenceSourceIds: [sourceId],
        confidence: affiliations.length ? 70 : 52,
        firstObservedAt: nowIso,
        lastVerifiedAt: nowIso,
        explanationData: {
          role: affiliations.length ? "Publication affiliation" : "Publisher metadata location",
          text: `${leadOrganisation} is related because Crossref metadata lists it as ${affiliations.length ? "an author affiliation" : "a publisher/funder metadata signal"} for this maritime research output.`,
        },
      },
    ],
  };
}

export async function fetchCrossrefMaritimeRecords(nowIso, options = {}) {
  const queries = options.queries ?? MARITIME_QUERIES;
  const recordsByKey = new Map();
  const errors = [];

  for (const query of queries) {
    try {
      console.log(`Fetching Crossref for query: "${query}"`);
      const records = await fetchCrossrefQuery(query);
      records.forEach((record) => {
        recordsByKey.set(getRecordKey(record.item), record);
      });
      console.log(`  Got ${records.length} raw Crossref results`);
      await delayMs(REQUEST_DELAY_MS);
    } catch (error) {
      console.warn(`  Failed to fetch Crossref for "${query}": ${error.message}`);
      errors.push(`${query}: ${error.message}`);
    }
  }

  const normalized = [...recordsByKey.values()]
    .map((record) => normalizeCrossrefRecord(record, nowIso))
    .filter(Boolean);

  if (normalized.length === 0 && errors.length > 0) {
    throw new Error(`All Crossref direct queries failed or produced no usable records. ${errors[0]}`);
  }

  return normalized;
}

export async function verifyCrossrefDoi(doi, nowIso) {
  if (!doi) {
    return null;
  }

  try {
    const url = `${API_URL}/${encodeURIComponent(doi)}`;
    const payload = await fetchJson(url, {
      fetchOptions: {
        email: CROSSREF_EMAIL,
        retries: 4,
        timeout: 30000,
        requestDelay: 500,
      },
    });

    const item = payload.message;

    return {
      source: {
        id: `source-crossref-${slugify(doi)}`,
        publisher: "Crossref",
        title: `Crossref DOI metadata for ${item.title?.[0] ?? doi}`,
        url: item.URL ?? `https://doi.org/${doi}`,
        sourceType: "api",
        authorityLevel: "C",
        primaryOrSecondary: "secondary",
        publicationDate:
          item.published?.["date-parts"]?.[0]?.filter(Boolean).join("-") ?? "",
        retrievedAt: nowIso,
        contentHash: hashContent(JSON.stringify(item)),
        licence: item.license?.[0]?.URL ?? "Crossref metadata",
        extractionMethod: "Crossref DOI verification",
        supportedProjectFields: ["researchOutputs", "publicationDate", "publisher"],
        reliabilityScore: 80,
      },
      metadata: item,
    };
  } catch (error) {
    console.warn(`Failed to verify Crossref DOI ${doi}: ${error.message}`);
    return null;
  }
}
