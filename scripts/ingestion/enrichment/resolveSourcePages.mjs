// Step 2 of the AI Evidence Selection pipeline (see CLAUDE.md goal tracker
// item 9): OpenAlex is only a discovery layer (titles, DOI, concepts). This
// module turns that discovery metadata into candidate *original* webpage
// URLs to actually visit in extractWebpage.mjs — plain code, no AI, no
// guessed URLs (every candidate comes from a field OpenAlex/the project
// itself already reported).

const GOVERNMENT_HINTS = [".gov", ".mil"];
const UNIVERSITY_HINTS = [
  ".edu",
  ".ac.",
  "university",
  "univ.",
  "institute",
  "polytechnic",
];
const PUBLISHER_HINTS = [
  "doi.org",
  "sciencedirect",
  "springer",
  "wiley",
  "ieee",
  "mdpi",
  "tandfonline",
  "elsevier",
  "nature.com",
];

export function classifySourceType(url) {
  if (!url) {
    return "other";
  }

  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }

  if (GOVERNMENT_HINTS.some((hint) => hostname.includes(hint))) {
    return "government";
  }
  if (PUBLISHER_HINTS.some((hint) => hostname.includes(hint))) {
    return "publisher";
  }
  if (UNIVERSITY_HINTS.some((hint) => hostname.includes(hint))) {
    return "university";
  }
  return "other";
}

/**
 * Returns an ordered, deduplicated list of { url, sourceType } candidates
 * worth fetching for a project, most-authoritative first. Every URL here
 * traces back to a field the project already carries (openAlex metadata or
 * an existing source record) — nothing is invented.
 */
export function resolveSourcePagesForProject(project) {
  const candidates = [];
  const seen = new Set();

  function add(url) {
    if (!url || seen.has(url)) {
      return;
    }
    try {
      // Validate it parses as an absolute URL before treating it as fetchable.
      new URL(url);
    } catch {
      return;
    }
    seen.add(url);
    candidates.push({ url, sourceType: classifySourceType(url) });
  }

  const openAlex = project.openAlex;
  if (openAlex) {
    // Prefer the open-access full text (most likely to have real detail),
    // then the publisher landing page, then the DOI resolver as a fallback.
    add(openAlex.openAccessUrl);
    add(openAlex.primaryLocationUrl);
    if (openAlex.doi) {
      add(openAlex.doi.startsWith("http") ? openAlex.doi : `https://doi.org/${openAlex.doi}`);
    }
  }

  return candidates;
}
