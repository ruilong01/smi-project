export const DISPLAY_SCORE_WEIGHTS = {
  sourceAuthority: 0.3,
  maritimeRelevance: 0.25,
  evidenceStrength: 0.15,
  recency: 0.15,
  dataCompleteness: 0.1,
  locationConfidence: 0.05,
};

export const MINIMUM_PUBLIC_DISPLAY_SCORE = 60;
export const EXACT_LOCATION_CONFIDENCE_THRESHOLD = 80;
export const CITY_LOCATION_CONFIDENCE_THRESHOLD = 60;

export const displayReasonLabels = {
  official_source_confirmation: "Confirmed by an official source",
  verified_location: "Location confidence is high enough for map display",
  city_level_location: "Displayed at city level because exact site is uncertain",
  country_level_location: "Displayed at country level because location detail is limited",
  matches_research_category: "Directly matches a maritime research category",
  updated_within_36_months: "Updated within the last 36 months",
  multiple_supporting_sources: "Supported by multiple sources",
  active_research_project: "Identified as an active research project",
  primary_source_available: "Includes at least one primary source",
};

function clampScore(value) {
  return Math.min(100, Math.max(0, Number(value) || 0));
}

export function calculateDisplayScore(signals) {
  return Math.round(
    Object.entries(DISPLAY_SCORE_WEIGHTS).reduce((total, [key, weight]) => {
      return total + clampScore(signals[key]) * weight;
    }, 0)
  );
}

export function getDisplayTier(displayScore) {
  if (displayScore < MINIMUM_PUBLIC_DISPLAY_SCORE) {
    return "hidden";
  }

  if (displayScore >= 90) {
    return "featured";
  }

  if (displayScore >= 75) {
    return "highlighted";
  }

  return "normal";
}

export function getLocationDisplayLevel(locationConfidence) {
  if (locationConfidence >= EXACT_LOCATION_CONFIDENCE_THRESHOLD) {
    return "exact";
  }

  if (locationConfidence >= CITY_LOCATION_CONFIDENCE_THRESHOLD) {
    return "city";
  }

  return "country";
}

export function getReadableDisplayReasons(reasonCodes) {
  return reasonCodes.map((code) => displayReasonLabels[code] ?? code);
}

export function enrichProjectForDisplay(project) {
  const displayScore = project.displayScore ?? calculateDisplayScore(project.scoringSignals);
  const displayTier = getDisplayTier(displayScore);
  const locationDisplayLevel = getLocationDisplayLevel(project.locationConfidence);

  return {
    ...project,
    displayScore,
    displayTier,
    displayReasonsText: getReadableDisplayReasons(project.displayReasons),
    isPubliclyDisplayable: displayTier !== "hidden",
    locationDisplayLevel,
  };
}
