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
