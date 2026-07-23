import crypto from "node:crypto";

const CATEGORY_RULES = [
  {
    category: "Autonomous navigation",
    terms: ["autonomous vessel", "autonomous ship", "unmanned surface", "navigation"],
  },
  {
    category: "Intelligent port services",
    terms: ["smart port", "port automation", "port digital", "terminal automation"],
  },
  {
    category: "Alternative energy and fuels",
    terms: ["ammonia", "hydrogen", "methanol", "alternative fuel", "green shipping"],
  },
  {
    category: "Maritime cybersecurity",
    terms: ["cybersecurity", "cyber security", "cyber risk"],
  },
  {
    category: "Digital twins",
    terms: ["digital twin", "simulation"],
  },
  {
    category: "Vessel efficiency",
    terms: ["vessel efficiency", "ship efficiency", "electrification", "emissions"],
  },
  {
    category: "Artificial intelligence",
    terms: ["artificial intelligence", "machine learning", "deep learning", "ai "],
  },
  {
    category: "Supply-chain and logistics",
    terms: ["logistics", "supply chain", "route optimisation", "route optimization"],
  },
  {
    category: "Marine robotics",
    terms: ["marine robot", "underwater vehicle", "auv", "rov", "underwater robot"],
  },
  {
    category: "Ship design and engineering",
    terms: ["ship design", "naval architecture", "hull design", "vessel design"],
  },
  {
    category: "Offshore and ocean technology",
    terms: ["offshore", "ocean energy", "marine renewable", "offshore wind"],
  },
];

const TECHNOLOGY_RULES = [
  ["Sensors", ["sensor", "monitoring", "perception"]],
  ["Artificial intelligence", ["artificial intelligence", "machine learning", "deep learning", "ai "]],
  ["Communications", ["communications", "connectivity", "data exchange"]],
  ["Navigation systems", ["navigation", "route", "collision avoidance"]],
  ["Alternative fuels", ["ammonia", "hydrogen", "methanol", "fuel"]],
  ["Digital twins", ["digital twin", "simulation"]],
  ["Port infrastructure", ["port", "terminal", "bunkering"]],
];

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

export function hashContent(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function classifyText(text) {
  const haystack = ` ${text.toLowerCase()} `;
  const categories = CATEGORY_RULES.filter((rule) =>
    rule.terms.some((term) => haystack.includes(term))
  ).map((rule) => rule.category);

  return [...new Set(categories)];
}

export function detectTechnologies(text) {
  const haystack = ` ${text.toLowerCase()} `;
  const technologies = TECHNOLOGY_RULES.filter(([, terms]) =>
    terms.some((term) => haystack.includes(term))
  ).map(([technology]) => technology);

  return [...new Set(technologies)];
}

export function isStrongMaritimeMatch(text) {
  const haystack = text.toLowerCase();
  const maritimeTerm =
    haystack.includes("maritime") ||
    haystack.includes("shipping") ||
    haystack.includes("vessel") ||
    haystack.includes("ship ") ||
    haystack.includes("port ");

  return maritimeTerm && classifyText(text).length > 0;
}

// OpenAlex's /works response never includes a plain `abstract` field - only
// `abstract_inverted_index`, a {word: [positions]} map (its standard way of
// serving abstract text without redistributing publisher-copyrighted raw
// text verbatim). Reconstructs the plain-text abstract from it; returns ""
// if the work has no inverted index at all (~20% of results, observed).
export function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") {
    return "";
  }

  const positions = [];
  for (const [word, indices] of Object.entries(invertedIndex)) {
    for (const index of indices) {
      positions[index] = word;
    }
  }

  return positions.join(" ").replace(/\s+/g, " ").trim();
}

export function firstSentence(text, fallback) {
  if (!text) {
    return fallback;
  }

  const cleaned = text.replace(/\s+/g, " ").trim();
  const match = cleaned.match(/^(.{40,260}?[.!?])\s/);
  return match ? match[1] : cleaned.slice(0, 260);
}

export function getRecencyScore(dateValue, now = new Date()) {
  if (!dateValue) {
    return 35;
  }

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return 35;
  }

  const months = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  if (months <= 12) return 100;
  if (months <= 36) return 82;
  if (months <= 60) return 62;
  return 40;
}

export function calculateDisplayScore(signals) {
  return Math.round(
    signals.sourceAuthority * 0.3 +
      signals.maritimeRelevance * 0.25 +
      signals.evidenceStrength * 0.15 +
      signals.recency * 0.15 +
      signals.dataCompleteness * 0.1 +
      signals.locationConfidence * 0.05
  );
}

export function displayTier(score) {
  if (score < 60) return "hidden";
  if (score >= 90) return "featured";
  if (score >= 75) return "highlighted";
  return "normal";
}

export function readableDisplayReasons(reasonCodes) {
  const labels = {
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

  return reasonCodes.map((code) => labels[code] ?? code);
}
