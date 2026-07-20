// Selected-country accent: a controlled coral, not an alarm-red, per the
// "premium intelligence dashboard" direction.
export const SELECTED_FOCUS_COLOR = "#E2624B";

// "Coverage pending" - a country the extraction pipeline hasn't verified
// any record for yet. Deliberately a NEUTRAL warm stone-grey (no blue/teal
// hue at all) so it reads as "unclassified terrain", never confusable with
// the very-low end of the teal->gold intensity ramp below - and bright
// enough to read clearly as SOLID LAND against the dark ocean, not a dim
// patch that blends in and looks "missing". Every landmass must always be
// visible first; intensity colour is a layer on top of that, not a
// replacement for it.
export const NO_DATA_FILL = "#6E7885";
const NO_DATA_HIGHLIGHT = "#8A93A0";
export const NO_DATA_LABEL = "Coverage pending";

// Coastline stroke is intentionally independent of intensity/fill colour -
// every country (data or no-data) gets the same relief-map border, so the
// base terrain map reads as one consistent, fully-present surface and
// colour is reserved for the intensity overlay meaning.
export const COUNTRY_BORDER_COLOR = "rgba(196, 222, 240, 0.45)";

// `highlight` is a lightened variant of `color`, used as the raking-light
// stop of each country's fill gradient (see TERRAIN_GRADIENT_DEFS below) so
// land reads as gently raised terrain rather than a flat colour fill - at
// zero extra per-frame cost, since it is still one flat `fill` paint value
// per path, just a gradient reference instead of a solid hex.
const intensityScale = {
  "very-low": {
    label: "Very Low",
    color: "#3E7CA6",
    highlight: "#5B94BA",
  },
  low: {
    label: "Low",
    color: "#2E93B0",
    highlight: "#4EA8C2",
  },
  "low-medium": {
    label: "Low-Medium",
    color: "#1FA8AC",
    highlight: "#3FBAC0",
  },
  medium: {
    label: "Medium",
    color: "#17BCA0",
    highlight: "#3ECDB4",
  },
  "medium-high": {
    label: "Medium-High",
    color: "#35CDA0",
    highlight: "#5CDBB6",
  },
  high: {
    label: "High",
    color: "#54E0C7",
    highlight: "#78E8D3",
  },
  "very-high": {
    label: "Very High",
    color: "#E7C95A",
    highlight: "#EEDA85",
  },
};

// Single source of truth for the <linearGradient> defs WorldMap.jsx renders
// once in <defs> and every country path references by id (fill="url(#...)")
// - shared across all countries in a bucket, so this adds no per-country or
// per-frame cost over a flat fill.
export const TERRAIN_GRADIENT_DEFS = [
  { id: "terrain-no-data", light: NO_DATA_HIGHLIGHT, base: NO_DATA_FILL },
  ...Object.entries(intensityScale).map(([level, { highlight, color }]) => ({
    id: `terrain-${level}`,
    light: highlight,
    base: color,
  })),
];

export function getIntensityLevel(score = 0) {
  if (score >= 86) {
    return "very-high";
  }

  if (score >= 71) {
    return "high";
  }

  if (score >= 56) {
    return "medium-high";
  }

  if (score >= 41) {
    return "medium";
  }

  if (score >= 26) {
    return "low-medium";
  }

  if (score >= 11) {
    return "low";
  }

  return "very-low";
}

export function getIntensityLabel(score = 0) {
  return intensityScale[getIntensityLevel(score)].label;
}

export function getIntensityColor(score = 0, isSelected = false) {
  if (isSelected) {
    return SELECTED_FOCUS_COLOR;
  }

  return intensityScale[getIntensityLevel(score)].color;
}

export function getIntensityOpacity(score = 0, hasData = true) {
  if (!hasData) {
    // Coverage-pending land must read as solid, ordinary terrain - as
    // opaque as any other landmass, never a faded/washed-out patch that
    // looks like it's missing from the map.
    return 0.92;
  }

  return Math.min(0.94, 0.55 + score / 230);
}

export function getCountryFill(country) {
  if (!country) {
    return "url(#terrain-no-data)";
  }

  return `url(#terrain-${getIntensityLevel(country.researchIntensity)})`;
}

// Border colour no longer tracks intensity - see COUNTRY_BORDER_COLOR above.
// Selection is the only thing allowed to override the coastline colour.
export function getCountryStroke(country, selectedCountry) {
  if (country && selectedCountry?.id === country.id) {
    return SELECTED_FOCUS_COLOR;
  }

  return COUNTRY_BORDER_COLOR;
}
