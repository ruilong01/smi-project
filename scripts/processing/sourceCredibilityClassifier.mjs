import { classifyImageSourceUrl } from "./imageSourceClassifier.mjs";
import { GLOBAL_SOURCE_REGISTRY } from "../ingestion/globalSourceRegistry.mjs";

// Source credibility classifier (Phase 1 of the global research scanner -
// see docs/GLOBAL_RESEARCH_SOURCE_STRATEGY.md). Given a URL, decides how
// much to trust it as a RESEARCH source and whether it's safe to fetch -
// reuses classifyImageSourceUrl's existing, already-tested domain
// patterns (government/funding, institution, publisher, DOI, CORDIS,
// OpenAIRE) rather than re-deriving them, so the two classifiers can never
// silently disagree about what counts as an official government page or a
// blocked publisher domain.

const REGISTRY_HOSTNAME_MAP = new Map();
GLOBAL_SOURCE_REGISTRY.forEach((source) => {
  if (!source.baseUrl) return;
  try {
    const hostname = new URL(source.baseUrl).hostname.toLowerCase().replace(/^www\./, "");
    REGISTRY_HOSTNAME_MAP.set(hostname, source);
  } catch {
    // no baseUrl to key off - generic-category registry entries (e.g.
    // "government-funding-page") are matched via classifyImageSourceUrl's
    // category below instead.
  }
});

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function findRegistryMatchByHostname(hostname) {
  if (!hostname) return null;
  if (REGISTRY_HOSTNAME_MAP.has(hostname)) return REGISTRY_HOSTNAME_MAP.get(hostname);
  for (const [registryHostname, source] of REGISTRY_HOSTNAME_MAP.entries()) {
    if (hostname === registryHostname || hostname.endsWith(`.${registryHostname}`)) return source;
  }
  return null;
}

// Maps classifyImageSourceUrl's URL-shape categories onto a research-
// source credibility tier/access type, for domains not directly in the
// registry's baseUrl list (e.g. any .gov page, any .edu page).
const CATEGORY_TO_CREDIBILITY = {
  cordis_project: { credibilityTier: "high", accessType: "public-website", matchedSourceId: "cordis" },
  openaire_project: { credibilityTier: "high", accessType: "public-api", matchedSourceId: "openaire" },
  government_or_funding_page: { credibilityTier: "high", accessType: "public-website", matchedSourceId: "government-funding-page" },
  institution_project_page: { credibilityTier: "medium", accessType: "public-website", matchedSourceId: "university-project-page" },
  official_press_release: { credibilityTier: "medium", accessType: "public-website", matchedSourceId: "government-funding-page" },
  project_website: { credibilityTier: "medium", accessType: "public-website", matchedSourceId: null },
  doi_redirect: { credibilityTier: "low", accessType: "restricted", matchedSourceId: "doi-resolver" },
  pdf: { credibilityTier: "medium", accessType: "restricted", matchedSourceId: null },
  publisher_article: { credibilityTier: "medium", accessType: "license-required", matchedSourceId: "academic-publisher" },
};

/**
 * @param {string} url
 * @returns {{ credibilityTier: "high"|"medium"|"low", accessType: string, matchedSourceId: string|null, reason: string }}
 */
export function classifySourceCredibility(url) {
  const hostname = hostnameOf(url);
  if (!hostname) {
    return { credibilityTier: "low", accessType: "unknown", matchedSourceId: null, reason: "Malformed URL - could not parse a hostname." };
  }

  const directMatch = findRegistryMatchByHostname(hostname);
  if (directMatch) {
    return {
      credibilityTier: directMatch.credibilityTier,
      accessType: directMatch.accessType,
      matchedSourceId: directMatch.sourceId,
      reason: `Matched source registry entry "${directMatch.sourceName}" (${directMatch.sourceId}).`,
    };
  }

  const imageClassification = classifyImageSourceUrl(url);
  const mapped = CATEGORY_TO_CREDIBILITY[imageClassification.category];
  if (mapped) {
    return {
      ...mapped,
      reason: `URL shape classifies as "${imageClassification.category}" (${imageClassification.reason})`,
    };
  }

  return {
    credibilityTier: "low",
    accessType: "needs-review",
    matchedSourceId: null,
    reason: `Unrecognized domain (${hostname}) - not in the source registry and does not match a known government/institution/publisher pattern. Treat as low-credibility until reviewed.`,
  };
}
