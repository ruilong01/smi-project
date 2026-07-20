import {
  COUNTRY_ATLAS_NAMES,
  COUNTRY_COORDINATES,
  COUNTRY_NAMES,
} from "./config.mjs";
import {
  calculateDisplayScore,
  displayTier,
  getRecencyScore,
  readableDisplayReasons,
  slugify,
} from "./normalization.mjs";

// Lean-MVP intensity score: record count dominates, institution count and
// topic diversity are minor adjustments only — deliberately simpler than a
// relationship-type-weighted formula. Always relative to whichever country
// currently has the highest raw score in this dataset, never an absolute
// or official measure. See the UI explanation text next to every score.
const INTENSITY_WEIGHTS = {
  recordCount: 1,
  institutionCount: 0.3,
  topicDiversity: 0.2,
};

function uniqueById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

function getProjectCountry(project, institutionsById) {
  if (project.countryCode) {
    return project.countryCode;
  }

  const institution = institutionsById.get(project.leadInstitutionId);
  return institution?.countryCode;
}

function scoreProject(project) {
  const sourceAuthority = project.sourceConfidence ?? 72;
  const maritimeRelevance = Math.min(100, 70 + (project.researchCategories?.length ?? 0) * 8);
  const evidenceStrength = Math.min(100, 54 + (project.sourceIds?.length ?? 0) * 14);
  const recency = getRecencyScore(project.lastUpdatedAt || project.startDate);
  const dataCompleteness = [
    project.title,
    project.leadOrganisation,
    project.plainLanguageSummary,
    project.researchCategories?.length,
    project.sourceIds?.length,
  ].filter(Boolean).length * 18;
  const locationConfidence = project.locationConfidence ?? 60;

  return {
    sourceAuthority,
    maritimeRelevance,
    evidenceStrength,
    recency,
    dataCompleteness: Math.min(100, dataCompleteness),
    locationConfidence,
  };
}

function enrichProject(project) {
  const countryCode = project.countryCode ?? project.country;
  const countryName = COUNTRY_NAMES[countryCode] ?? project.country;
  const countryCoordinates = COUNTRY_COORDINATES[countryCode];
  const scoringSignals = project.scoringSignals ?? scoreProject(project);
  const displayScore = calculateDisplayScore(scoringSignals);
  const tier = displayTier(displayScore);
  const displayReasons = [...new Set(project.displayReasons ?? [])];

  if (project.sourceConfidence >= 85) displayReasons.push("official_source_confirmation");
  if (project.locationConfidence >= 80) displayReasons.push("verified_location");
  if (project.locationConfidence >= 60 && project.locationConfidence < 80) {
    displayReasons.push("city_level_location");
  }
  if (project.researchCategories?.length) displayReasons.push("matches_research_category");
  if (scoringSignals.recency >= 82) displayReasons.push("updated_within_36_months");
  if ((project.sourceIds?.length ?? 0) > 1) displayReasons.push("multiple_supporting_sources");
  if (["Active project", "Official source page"].includes(project.projectStatus)) {
    displayReasons.push("active_research_project");
  }
  if (project.sourceIds?.length) displayReasons.push("primary_source_available");

  return {
    ...project,
    countryCode,
    country: countryName,
    latitude: project.latitude ?? countryCoordinates?.[1] ?? null,
    longitude: project.longitude ?? countryCoordinates?.[0] ?? null,
    displayScore,
    displayTier: tier,
    isPubliclyDisplayable: tier !== "hidden",
    displayReasons: [...new Set(displayReasons)],
    displayReasonsText: readableDisplayReasons([...new Set(displayReasons)]),
    scoringSignals,
    locationDisplayLevel:
      project.locationConfidence >= 80
        ? "exact"
        : project.locationConfidence >= 60
          ? "city"
          : "country",
    images: project.images?.length
      ? project.images
      : [
          {
            url: "",
            sourcePageUrl: "",
            creator: "Internal technical placeholder",
            licence: "Original placeholder generated for this frontend demo",
            attributionRequired: false,
            caption: "No verified project image is available.",
            imageType: "placeholder",
            isOfficialProjectImage: false,
          },
        ],
  };
}

function buildCountryRelationships(projects, institutionsById, nowIso) {
  const relationships = [];

  projects.forEach((project) => {
    const countryCode = getProjectCountry(project, institutionsById);
    if (!countryCode) {
      return;
    }

    relationships.push({
      id: `rel-country-${countryCode}-${project.id}-location`,
      sourceEntityType: "COUNTRY",
      sourceEntityId: countryCode,
      targetEntityType: "PROJECT",
      targetEntityId: project.id,
      relationType: project.locationPrecision?.includes("trial")
        ? "TRIAL_LOCATION"
        : "PROJECT_LOCATION",
      evidenceSourceIds: project.sourceIds,
      confidence: project.locationConfidence ?? 70,
      firstObservedAt: project.firstSeenAt ?? nowIso,
      lastVerifiedAt: project.lastVerifiedAt ?? nowIso,
      explanationData: {
        role: "Project location",
        text: `${COUNTRY_NAMES[countryCode] ?? countryCode} is related because extracted source records locate this maritime R&D record there.`,
      },
    });

    if (project.leadInstitutionId) {
      const institution = institutionsById.get(project.leadInstitutionId);
      if (institution?.countryCode) {
        relationships.push({
          id: `rel-country-${institution.countryCode}-${project.id}-lead-institution`,
          sourceEntityType: "COUNTRY",
          sourceEntityId: institution.countryCode,
          targetEntityType: "PROJECT",
          targetEntityId: project.id,
          relationType: "LEAD_INSTITUTION_COUNTRY",
          evidenceSourceIds: project.sourceIds,
          confidence: 78,
          firstObservedAt: project.firstSeenAt ?? nowIso,
          lastVerifiedAt: project.lastVerifiedAt ?? nowIso,
          explanationData: {
            role: "Lead institution country",
            text: `${COUNTRY_NAMES[institution.countryCode] ?? institution.countryCode} is related because the lead institution is based there.`,
          },
        });
      }
    }
  });

  return relationships;
}

export function buildDataset({ adapterOutputs, extractionRuns, nowIso, sourceStatus }) {
  const projects = [];
  const institutions = [];
  const sources = [];
  const relationships = [];

  adapterOutputs.forEach((output) => {
    if (!output) return;
    if (output.project) projects.push(output.project);
    if (output.projects) projects.push(...output.projects);
    if (output.institution) institutions.push(output.institution);
    if (output.institutions) institutions.push(...output.institutions);
    if (output.source) sources.push(output.source);
    if (output.sources) sources.push(...output.sources);
    if (output.relationship) relationships.push(output.relationship);
    if (output.relationships) relationships.push(...output.relationships);
  });

  const institutionsById = new Map(uniqueById(institutions).map((item) => [item.id, item]));
  const dedupedProjects = uniqueById(projects).map((project) =>
    enrichProject(project)
  );
  const countryRelationships = buildCountryRelationships(
    dedupedProjects,
    institutionsById,
    nowIso
  );
  const allRelationships = uniqueById([...relationships, ...countryRelationships]);
  const countries = buildCountries(dedupedProjects, allRelationships, institutionsById, nowIso);

  return {
    meta: {
      schemaVersion: 1,
      generatedAt: nowIso,
      lastSuccessfulSync: nowIso,
      unavailable: dedupedProjects.filter((project) => project.isPubliclyDisplayable).length === 0,
      statusMessage:
        dedupedProjects.filter((project) => project.isPubliclyDisplayable).length === 0
          ? "Live research data is temporarily unavailable."
          : "Traceable maritime R&D data extracted from configured sources.",
      testingRefreshIntervalMs: 5 * 60 * 1000,
      extractionSchedule: {
        testing: "Every 5 minutes with npm run sync:watch",
        structuredApis: "Every 6 hours in production",
        officialWebpages: "Every 12 to 24 hours in production",
      },
      sourceStatus,
    },
    projects: dedupedProjects,
    publicProjects: dedupedProjects.filter((project) => project.isPubliclyDisplayable),
    institutions: uniqueById(institutions),
    countries,
    sources: uniqueById(sources),
    relationships: allRelationships,
    extractionRuns,
  };
}

export function buildCountries(projects, relationships, institutionsById, nowIso) {
  const countries = new Map();

  function ensureCountry(countryCode) {
    if (!countryCode || !COUNTRY_ATLAS_NAMES[countryCode]) {
      return null;
    }

    if (!countries.has(countryCode)) {
      countries.set(countryCode, {
        id: countryCode.toLowerCase(),
        code: countryCode,
        slug: slugify(COUNTRY_NAMES[countryCode]),
        name: COUNTRY_NAMES[countryCode],
        region: "",
        atlasName: COUNTRY_ATLAS_NAMES[countryCode],
        coordinates: COUNTRY_COORDINATES[countryCode],
        researchIntensity: 0,
        themes: [],
        institutions: [],
        exampleProjects: [],
        summary: "",
        aiInsight: "",
        dataStatus: "Traceable extracted data",
        dataUpdatedUntil: nowIso.slice(0, 10),
        sources: [],
        activity: {
          verifiedProjects: 0,
          leadProjects: 0,
          partnerProjects: 0,
          institutions: 0,
          publications: 0,
          activityScore: 0,
          lastUpdated: nowIso,
        },
        whyRelated: [],
      });
    }

    return countries.get(countryCode);
  }

  const projectById = new Map(projects.map((project) => [project.id, project]));

  relationships
    .filter((relationship) => relationship.sourceEntityType === "COUNTRY")
    .forEach((relationship) => {
      const country = ensureCountry(relationship.sourceEntityId);
      const project = projectById.get(relationship.targetEntityId);
      if (!country || !project) return;

      country.whyRelated.push(relationship);
      if (!country.exampleProjects.includes(project.title)) {
        country.exampleProjects.push(project.title);
      }
      project.researchCategories.forEach((category) => {
        if (!country.themes.includes(category)) country.themes.push(category);
      });
      project.sourceIds.forEach((sourceId) => {
        if (!country.sources.includes(sourceId)) country.sources.push(sourceId);
      });
      country.activity._projectIds = [
        ...(country.activity._projectIds ?? []),
        project.id,
      ];
      if (relationship.relationType === "LEAD_INSTITUTION_COUNTRY") {
        country.activity._leadProjectIds = [
          ...(country.activity._leadProjectIds ?? []),
          project.id,
        ];
      }
      if (relationship.relationType === "PARTNER_COUNTRY") {
        country.activity._partnerProjectIds = [
          ...(country.activity._partnerProjectIds ?? []),
          project.id,
        ];
      }
      if (project.entityType === "RESEARCH_PAPER") {
        country.activity._publicationProjectIds = [
          ...(country.activity._publicationProjectIds ?? []),
          project.id,
        ];
      }
    });

  projects.forEach((project) => {
    const institution = institutionsById.get(project.leadInstitutionId);
    if (institution?.countryCode) {
      const country = ensureCountry(institution.countryCode);
      if (country && !country.institutions.includes(institution.canonicalName)) {
        country.institutions.push(institution.canonicalName);
      }
    }
  });

  const rawScores = [...countries.values()].map((country) => {
    const verifiedProjects = new Set(country.activity._projectIds ?? []).size;
    const institutionCount = country.institutions.length;
    const topicDiversity = country.themes.length;
    const raw =
      verifiedProjects * INTENSITY_WEIGHTS.recordCount +
      institutionCount * INTENSITY_WEIGHTS.institutionCount +
      topicDiversity * INTENSITY_WEIGHTS.topicDiversity;
    country.activity._rawScore = raw;
    return raw;
  });
  const maxRawScore = Math.max(...rawScores, 1);

  return [...countries.values()].map((country) => {
    const scaled = Math.round((country.activity._rawScore / maxRawScore) * 100);
    country.activity.verifiedProjects = new Set(country.activity._projectIds ?? []).size;
    country.activity.leadProjects = new Set(country.activity._leadProjectIds ?? []).size;
    country.activity.partnerProjects = new Set(country.activity._partnerProjectIds ?? []).size;
    country.activity.publications = new Set(country.activity._publicationProjectIds ?? []).size;
    country.activity.institutions = country.institutions.length;
    country.activity.activityScore = Number(country.activity._rawScore.toFixed(2));
    country.researchIntensity = scaled;
    country.summary = `${country.name} has ${country.activity.verifiedProjects} verified maritime R&D record(s) in the extracted dataset.`;
    country.aiInsight = "Relationship explanations are assembled from source-backed relationship records, not unsupported AI inference.";
    delete country.activity._projectIds;
    delete country.activity._leadProjectIds;
    delete country.activity._partnerProjectIds;
    delete country.activity._publicationProjectIds;
    delete country.activity._rawScore;
    return country;
  });
}
