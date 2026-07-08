import { describe, expect, it } from "vitest";
import {
  calculateDisplayScore,
  enrichProjectForDisplay,
  getDisplayTier,
  getLocationDisplayLevel,
} from "./projectScoring.js";

describe("project display scoring", () => {
  it("calculates the weighted display score", () => {
    const score = calculateDisplayScore({
      sourceAuthority: 100,
      maritimeRelevance: 80,
      evidenceStrength: 60,
      recency: 40,
      dataCompleteness: 50,
      locationConfidence: 90,
    });

    expect(score).toBe(75);
  });

  it("applies public display thresholds", () => {
    expect(getDisplayTier(59)).toBe("hidden");
    expect(getDisplayTier(60)).toBe("normal");
    expect(getDisplayTier(75)).toBe("highlighted");
    expect(getDisplayTier(90)).toBe("featured");
  });

  it("marks low-confidence projects as hidden", () => {
    const project = enrichProjectForDisplay({
      scoringSignals: {
        sourceAuthority: 35,
        maritimeRelevance: 70,
        evidenceStrength: 38,
        recency: 46,
        dataCompleteness: 35,
        locationConfidence: 52,
      },
      displayReasons: ["matches_research_category"],
      locationConfidence: 52,
    });

    expect(project.isPubliclyDisplayable).toBe(false);
    expect(project.displayTier).toBe("hidden");
  });

  it("selects exact, city and country display levels from confidence", () => {
    expect(getLocationDisplayLevel(94)).toBe("exact");
    expect(getLocationDisplayLevel(68)).toBe("city");
    expect(getLocationDisplayLevel(52)).toBe("country");
  });
});
