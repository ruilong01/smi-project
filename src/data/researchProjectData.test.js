import { describe, expect, it } from "vitest";
import {
  extractionRuns,
  getRelationshipEntityLabel,
  getRelationshipEvidenceSources,
  liveResearchCountries,
  liveResearchMeta,
  liveResearchRelationships,
  maritimeResearchCategories,
  publicResearchProjects,
  researchProjects,
} from "./researchProjectData.js";
import {
  getSourceById,
  validateSourceUrls,
} from "./sourceRegistry.js";

describe("generated maritime research data", () => {
  it("publishes only source-backed projects above the display threshold", () => {
    expect(publicResearchProjects.length).toBeGreaterThan(0);

    publicResearchProjects.forEach((project) => {
      expect(project.displayScore).toBeGreaterThanOrEqual(60);
      expect(project.isPubliclyDisplayable).toBe(true);
      expect(project.sourceIds.length).toBeGreaterThan(0);
      expect(project.title).toBeTruthy();
      expect(project.country).toBeTruthy();
    });
  });

  it("keeps source status and refresh metadata with the generated dataset", () => {
    expect(liveResearchMeta.unavailable).toBe(false);
    expect(liveResearchMeta.testingRefreshIntervalMs).toBe(5 * 60 * 1000);
    expect(liveResearchMeta.sourceStatus.length).toBeGreaterThan(0);
    expect(extractionRuns.length).toBe(liveResearchMeta.sourceStatus.length);
  });

  it("uses valid source URLs and resolvable source references", () => {
    expect(validateSourceUrls()).toBe(true);

    researchProjects.forEach((project) => {
      project.sourceIds.forEach((sourceId) => {
        expect(getSourceById(sourceId)).toBeTruthy();
      });

      Object.values(project.fieldSources ?? {}).flat().forEach((sourceId) => {
        expect(getSourceById(sourceId)).toBeTruthy();
      });
    });
  });

  it("keeps country-project-institution relationships explainable", () => {
    expect(liveResearchRelationships.length).toBeGreaterThan(0);

    liveResearchRelationships.forEach((relationship) => {
      expect(relationship.targetEntityType).toBe("PROJECT");
      expect(relationship.targetEntityId).toBeTruthy();
      expect(relationship.relationType).toBeTruthy();
      expect(relationship.confidence).toBeGreaterThan(0);
      expect(relationship.explanationData?.text).toBeTruthy();
      expect(getRelationshipEntityLabel(relationship)).toBeTruthy();
      expect(getRelationshipEvidenceSources(relationship).length).toBeGreaterThan(0);
    });
  });

  it("builds country intensity from relationship-backed activity", () => {
    expect(liveResearchCountries.length).toBeGreaterThan(0);

    liveResearchCountries.forEach((country) => {
      expect(country.whyRelated.length).toBeGreaterThan(0);
      expect(country.researchIntensity).toBeGreaterThan(0);
      expect(country.activity.verifiedProjects).toBeGreaterThan(0);
      expect(country.activity.institutions).toBe(country.institutions.length);
    });
  });

  it("uses supported maritime research categories", () => {
    researchProjects.forEach((project) => {
      project.researchCategories.forEach((category) => {
        expect(maritimeResearchCategories).toContain(category);
      });
    });
  });
});
