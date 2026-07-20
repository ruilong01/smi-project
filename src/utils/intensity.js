export const SELECTED_FOCUS_COLOR = "#E64141";
export const NO_DATA_FILL = "#244B59";
export const NO_DATA_STROKE = "#4C7885";

const intensityScale = {
  "very-low": {
    label: "Very Low",
    color: "#0F5D67",
  },
  low: {
    label: "Low",
    color: "#187C83",
  },
  "low-medium": {
    label: "Low-Medium",
    color: "#1A9A96",
  },
  medium: {
    label: "Medium",
    color: "#22B8AE",
  },
  "medium-high": {
    label: "Medium-High",
    color: "#39CDBB",
  },
  high: {
    label: "High",
    color: "#54E0C7",
  },
  "very-high": {
    label: "Very High",
    color: "#E7C95A",
  },
};

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
    return 0.32;
  }

  return Math.min(0.94, 0.52 + score / 230);
}

export function getCountryFill(country) {
  if (!country) {
    return NO_DATA_FILL;
  }

  return getIntensityColor(country.researchIntensity, false);
}

export function getCountryStroke(country, selectedCountry) {
  if (!country) {
    return NO_DATA_STROKE;
  }

  if (selectedCountry?.id === country.id) {
    return SELECTED_FOCUS_COLOR;
  }

  return getIntensityColor(country.researchIntensity, false);
}
