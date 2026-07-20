import { liveResearchSources } from "./researchProjectData.js";
import { isValidExternalUrl } from "../utils/url.js";

export const SOURCE_AUTHORITY_LEVELS = {
  A: "Government, regulator or official project database",
  B: "University, research institution or classification society",
  C: "Peer-reviewed publication or patent database",
  D: "Official company announcement",
  E: "Specialist maritime news",
  F: "Unverified secondary content",
};

// Static metadata about the configured pipeline sources themselves
// (not extracted research records, so no per-item URL/timestamp needed).
// homepage values match the base API/site URLs already used in
// scripts/ingestion/adapters/*.mjs.
export const SOURCE_ADAPTER_META = {
  openalex: {
    icon: "BookOpen",
    homepage: "https://api.openalex.org/works",
    description:
      "Free, open index of scholarly works, authors and institutions. Supplies maritime R&D publications and their author-institution affiliations.",
  },
  crossref: {
    icon: "Link2",
    homepage: "https://api.crossref.org",
    description:
      "DOI registration agency's public API. Supplies publication metadata (titles, dates, links) used to verify and enrich research records.",
  },
  ror: {
    icon: "Building2",
    homepage: "https://api.ror.org/v2/organizations",
    description:
      "Research Organization Registry — a persistent identifier registry for research institutions. Used to resolve and de-duplicate institution names.",
  },
  mpa: {
    icon: "Landmark",
    homepage: "https://www.mpa.gov.sg/",
    description:
      "Maritime and Port Authority of Singapore's official R&D pages. Controlled extraction of Singapore government maritime research programmes.",
  },
  manual: {
    icon: "UserCheck",
    homepage: null,
    description:
      "Human-verified records added by hand in scripts/ingestion/manualSources.mjs, each with its own real source URL and verification date — no automated fetching involved.",
  },
};

export function getSourceAdapterMeta(sourceId) {
  return SOURCE_ADAPTER_META[sourceId];
}

export const sourceRecords = liveResearchSources;

export const sourcesById = new Map(
  sourceRecords.map((source) => [source.id, source])
);

export function getSourceById(sourceId) {
  return sourcesById.get(sourceId);
}

export function getSourcesByIds(sourceIds = []) {
  return sourceIds.map(getSourceById).filter(Boolean);
}

export function getSourcesForProject(project) {
  return getSourcesByIds(project.sourceIds).sort((sourceA, sourceB) => {
    if (sourceA.primaryOrSecondary !== sourceB.primaryOrSecondary) {
      return sourceA.primaryOrSecondary === "primary" ? -1 : 1;
    }

    return sourceA.authorityLevel.localeCompare(sourceB.authorityLevel);
  });
}

export function validateSourceUrls(sources = sourceRecords) {
  return sources.every((source) => isValidExternalUrl(source.url));
}
