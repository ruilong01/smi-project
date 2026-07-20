import liveResearchData from "./generated/liveResearchData.json";

/**
 * DATA SOURCE SEAM (Goal 6).
 *
 * Today the dataset is a build-time import of the generated JSON. In
 * Phase 2 the frontend will fetch the same shape from the backend API
 * (GET /api/... served by server/server.mjs). When that happens, ONLY
 * this seam changes: replace the static import above with fetched data
 * and every derived export below keeps working unchanged.
 *
 * All modules must access the dataset through loadResearchData() or the
 * derived exports below — never import the JSON file directly elsewhere.
 */
const researchDataset = liveResearchData;

export function loadResearchData() {
  return researchDataset;
}

export const entityTypes = [
  "PROJECT",
  "ORGANISATION",
  "RESEARCH_PAPER",
  "PATENT",
  "RESEARCH_FACILITY",
  "POLICY_OR_ROADMAP",
  "TRIAL_OR_DEMONSTRATION",
];

export const maritimeResearchCategories = [
  "Autonomous port operations",
  "Alternative energy and fuels",
  "Smart ships",
  "Intelligent port services",
  "Autonomous navigation",
  "Artificial intelligence",
  "Digital twins",
  "Port automation",
  "Maritime cybersecurity",
  "Vessel efficiency",
  "Carbon capture",
  "Maritime communications",
  "Safety and risk management",
  "Supply-chain and logistics",
];

export const topicToProjectCategories = {
  "Green Shipping": [
    "Alternative energy and fuels",
    "Vessel efficiency",
    "Carbon capture",
  ],
  "Smart Ports": [
    "Autonomous port operations",
    "Intelligent port services",
    "Digital twins",
    "Port automation",
    "Supply-chain and logistics",
  ],
  "Autonomous Vessels": ["Autonomous navigation", "Smart ships"],
  "Maritime AI": ["Artificial intelligence", "Digital twins"],
  "Alternative Fuels": ["Alternative energy and fuels", "Carbon capture"],
  "Maritime Cybersecurity": ["Maritime cybersecurity", "Safety and risk management"],
};

// Reverse lookup: a raw research category (e.g. "Vessel efficiency") is not
// itself a topic slug — it belongs to one or more of the 6 curated topics
// above. Used anywhere a country/project theme tag needs to link to a real
// /topic/:slug page instead of the category name itself.
export function getTopicNameForCategory(category) {
  return Object.keys(topicToProjectCategories).find((topicName) =>
    topicToProjectCategories[topicName].includes(category)
  );
}

export const technologyExplanations = {
  Sensors:
    "Sensors collect information from vessels, ports, engines, weather, cargo and nearby traffic so digital systems can understand what is happening in real time.",
  "Artificial intelligence":
    "Artificial intelligence helps classify patterns, predict risk, optimise operations and support decisions. In this app it is only described when source records identify the technology.",
  Communications:
    "Maritime communications connect vessels, ports, control centres and data platforms so operational information can move safely between sea and shore.",
  "Navigation systems":
    "Navigation systems combine positioning, route planning, traffic awareness and decision support to help vessels move safely and efficiently.",
  "Alternative fuels":
    "Alternative fuels such as ammonia, hydrogen and methanol are researched as lower-carbon pathways for shipping, with safety and bunkering readiness as key constraints.",
  "Digital twins":
    "Digital twins are virtual models of vessels, ports or operations that help researchers simulate scenarios, test decisions and monitor performance.",
  "Port infrastructure":
    "Port infrastructure includes terminals, berths, shore power, bunkering systems, data platforms and operational facilities that enable maritime services.",
};

export const liveResearchMeta = loadResearchData().meta;
export const researchProjects = loadResearchData().projects;
export const publicResearchProjects = loadResearchData().publicProjects;
export const liveResearchCountries = loadResearchData().countries;
export const liveResearchInstitutions = loadResearchData().institutions;
export const liveResearchRelationships = loadResearchData().relationships;
export const liveResearchSources = loadResearchData().sources;
export const extractionRuns = loadResearchData().extractionRuns;

export const isLiveResearchDataAvailable =
  !liveResearchMeta.unavailable && publicResearchProjects.length > 0;

export const researchProjectsBySlug = new Map(
  researchProjects.map((project) => [project.slug, project])
);
export const researchProjectsById = new Map(
  researchProjects.map((project) => [project.id, project])
);
export const institutionsById = new Map(
  liveResearchInstitutions.map((institution) => [institution.id, institution])
);
export const countriesByCode = new Map(
  liveResearchCountries.map((country) => [country.code, country])
);
export const countriesBySlug = new Map(
  liveResearchCountries.map((country) => [country.slug, country])
);
export const liveSourcesById = new Map(
  liveResearchSources.map((source) => [source.id, source])
);

export const relationshipsByProjectId = new Map();
liveResearchRelationships.forEach((relationship) => {
  const existing = relationshipsByProjectId.get(relationship.targetEntityId) ?? [];
  existing.push(relationship);
  relationshipsByProjectId.set(relationship.targetEntityId, existing);
});

export function getResearchProjectBySlug(slug) {
  return researchProjectsBySlug.get(slug);
}

export function getResearchProjectById(projectId) {
  return researchProjectsById.get(projectId);
}

export function getCountryBySlug(slug) {
  return countriesBySlug.get(slug);
}

export function getCountryByCode(countryCode) {
  return countriesByCode.get(countryCode);
}

export function getInstitutionById(institutionId) {
  return institutionsById.get(institutionId);
}

export function getLiveSourceById(sourceId) {
  return liveSourcesById.get(sourceId);
}

export function getProjectsForCountry(countryName) {
  return publicResearchProjects.filter((project) => project.country === countryName);
}

export function getRelationshipsForProject(projectId) {
  return relationshipsByProjectId.get(projectId) ?? [];
}

export function getRelationshipEntityLabel(relationship) {
  if (relationship.sourceEntityType === "INSTITUTION") {
    return (
      getInstitutionById(relationship.sourceEntityId)?.canonicalName ??
      relationship.sourceEntityId
    );
  }

  if (relationship.sourceEntityType === "COUNTRY") {
    return getCountryByCode(relationship.sourceEntityId)?.name ?? relationship.sourceEntityId;
  }

  return relationship.sourceEntityId;
}

export function getRelationshipEvidenceSources(relationship) {
  return (relationship.evidenceSourceIds ?? [])
    .map((sourceId) => getLiveSourceById(sourceId))
    .filter(Boolean);
}

export function formatRelationType(relationType = "") {
  return relationType
    .toLowerCase()
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

export function projectMatchesTopicFilter(project, activeFilter) {
  if (activeFilter === "All") {
    return true;
  }

  const categories = topicToProjectCategories[activeFilter] ?? [activeFilter];
  return project.researchCategories.some((category) =>
    categories.includes(category)
  );
}

export function countryMatchesTopicFilter(country, activeFilter) {
  if (activeFilter === "All") {
    return true;
  }

  const categories = topicToProjectCategories[activeFilter] ?? [activeFilter];
  return country.themes.some((category) => categories.includes(category));
}

export function getLiveDataStatusLabel() {
  if (!isLiveResearchDataAvailable) {
    return "Live research data is temporarily unavailable.";
  }

  return `Last synchronised: ${new Date(
    liveResearchMeta.lastSuccessfulSync
  ).toLocaleString()}. Sources: ${liveResearchMeta.sourceStatus.length}.`;
}
