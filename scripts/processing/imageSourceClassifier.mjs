// Classifies a source URL BEFORE anything ever tries to fetch it, so the
// image-enrichment pipeline never wastes a request (or retries) on a URL
// that structurally cannot yield a usable project image: a DOI redirect,
// a raw PDF, or an academic publisher's article page. Most publishers
// actively block automated fetching (403s the norm, not the exception -
// see the OpenAlex publication-image test earlier in this project's
// history: ~0.4% hit rate, mostly 403s) and even when they don't block it,
// a journal article page has no project-specific image to find.
//
// Shared by scripts/ingestion/queueEnrichment.mjs (queue-time filter) and
// scripts/ingestion/enrichImages.mjs (skip-before-fetch).

// Bump whenever the classification rules change (a new blocked/allowed
// pattern, a new publisher added, etc). Stamped onto queue/report output so
// verify:image-enrichment can tell a snapshot written by an older ruleset
// apart from one written by the current code, instead of trusting stale
// data as if it reflects current behaviour.
export const CLASSIFIER_VERSION = 2;

export const FETCH_ALLOWED_CATEGORIES = [
  "project_website",
  "cordis_project",
  "openaire_project",
  "institution_project_page",
  "official_press_release",
  "government_or_funding_page",
];

export const FETCH_BLOCKED_CATEGORIES = ["doi_redirect", "pdf", "publisher_article", "unknown"];

const DOI_HOSTNAME_PATTERN = /(^|\.)doi\.org$/i;
const PDF_URL_PATTERN = /\.pdf(\?|#|$)|\/pdf(\/|\?|#|$)/i;

// Known academic publisher domains - these serve journal article pages,
// not project websites, regardless of how the URL looks. Extend this list
// as new blocked-in-practice publishers turn up; do NOT try to fetch first
// and see what happens - that's exactly the wasted-retry behaviour this
// classifier exists to prevent.
const PUBLISHER_HOSTNAMES = [
  "mdpi.com",
  "tandfonline.com",
  "pubs.rsc.org",
  "rsc.org",
  "sciencedirect.com",
  "springer.com",
  "link.springer.com",
  "wiley.com",
  "onlinelibrary.wiley.com",
  "ieee.org",
  "ieeexplore.ieee.org",
  "nature.com",
  "acs.org",
  "pubs.acs.org",
  "frontiersin.org",
  "hindawi.com",
  "sagepub.com",
  "cambridge.org",
  "academic.oup.com",
  "oup.com",
  "tandf.co.uk",
  "elsevier.com",
  "researchgate.net",
  "ssrn.com",
  "jstor.org",
  "emerald.com",
  "taylorfrancis.com",
];

const GOVERNMENT_OR_FUNDING_HOSTNAME_KEYWORDS = ["ec.europa.eu", "europa.eu", ".gov", ".gov.", "horizon-europe"];
const INSTITUTION_HOSTNAME_PATTERN = /\.edu$|\.ac\.[a-z]{2,3}$|\.edu\.[a-z]{2,3}$|university|\buniv[-.]|institute|polytechnic/i;

// A .edu/.ac.xx hostname is not by itself proof of a project's own page -
// plenty of universities host their journal/repository system on that
// same domain (an OJS-based e-journal, an institutional repository like
// VTechWorks/DigitalCommons, a library catalog like CiNii). Those serve
// publication downloads and metadata records, not project websites, and
// are rejected regardless of how institutional the hostname looks.
const REPOSITORY_OR_ARTICLE_PATH_PATTERN =
  /\/article(s)?\/|\/abstract\/|\/abs\/|\/fulltext\/|\/download\b|\/downloads\/|\/bitstreams?\b|\/handle\/|\/doi\/|\/ojs\/|\/ncid\/|\/pii\/|\/record\/|\/items\/|portalfiles/i;
const REPOSITORY_PLATFORM_HOSTNAME_PATTERN = /digitalcommons|dspace|eprints|scholarworks|bepress|vtechworks/i;

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function matchesHostname(hostname, knownHost) {
  return hostname === knownHost || hostname.endsWith(`.${knownHost}`);
}

/**
 * @returns {{ category: string, fetchAllowed: boolean, reason: string }}
 */
export function classifyImageSourceUrl(url) {
  if (!url) {
    return { category: "unknown", fetchAllowed: false, reason: "No URL provided." };
  }

  const hostname = hostnameOf(url);
  if (!hostname) {
    return { category: "unknown", fetchAllowed: false, reason: "Malformed URL - could not parse a hostname." };
  }

  if (DOI_HOSTNAME_PATTERN.test(hostname)) {
    return {
      category: "doi_redirect",
      fetchAllowed: false,
      reason: "doi.org redirects to the publisher's page, not fetched directly - resolve to the real landing page first if one is known.",
    };
  }

  if (PDF_URL_PATTERN.test(url)) {
    return { category: "pdf", fetchAllowed: false, reason: "URL points to a PDF, not an HTML page with embeddable/og:image content." };
  }

  if (REPOSITORY_OR_ARTICLE_PATH_PATTERN.test(url) || REPOSITORY_PLATFORM_HOSTNAME_PATTERN.test(hostname)) {
    return {
      category: "publisher_article",
      fetchAllowed: false,
      reason: `URL path/hostname (${hostname}) matches a repository/journal-article/download pattern - a publication page, not a project website, regardless of the institutional domain.`,
    };
  }

  if (PUBLISHER_HOSTNAMES.some((known) => matchesHostname(hostname, known))) {
    return {
      category: "publisher_article",
      fetchAllowed: false,
      reason: `Known academic publisher domain (${hostname}) - frequently blocks automated fetching and has no project-specific image.`,
    };
  }

  if (hostname === "cordis.europa.eu" && /\/project\//.test(url)) {
    return { category: "cordis_project", fetchAllowed: true, reason: "Official CORDIS project page." };
  }

  if (matchesHostname(hostname, "openaire.eu")) {
    return { category: "openaire_project", fetchAllowed: true, reason: "Official OpenAIRE project page." };
  }

  if (GOVERNMENT_OR_FUNDING_HOSTNAME_KEYWORDS.some((keyword) => hostname.includes(keyword))) {
    return { category: "government_or_funding_page", fetchAllowed: true, reason: `Government/EU funding-programme domain (${hostname}).` };
  }

  if (INSTITUTION_HOSTNAME_PATTERN.test(hostname)) {
    return { category: "institution_project_page", fetchAllowed: true, reason: `University/institution domain (${hostname}).` };
  }

  // Anything else is genuinely ambiguous from the URL alone - could be a
  // real project/consortium website (project_website, allowed) or an
  // unrecognised aggregator/publisher we haven't listed (unknown,
  // blocked). Defaulting to blocked is the safe choice: an unrecognised
  // domain gets explicitly added to the allowed patterns above once it's
  // actually confirmed to be a project's own site, not assumed safe by
  // silently trying to fetch it first.
  return {
    category: "unknown",
    fetchAllowed: false,
    reason: `Unrecognised domain (${hostname}) - not in the known allowed or blocked lists; defaulting to blocked rather than guessing.`,
  };
}

export function classifySourceUrls(urls) {
  return (urls ?? []).map((url) => ({ url, ...classifyImageSourceUrl(url) }));
}
