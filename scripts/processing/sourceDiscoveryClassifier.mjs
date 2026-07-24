// Classifies a DISCOVERED source URL (as opposed to imageSourceClassifier's
// job of classifying a record's already-known sourceUrl before fetching
// for images). Reuses the same DOI/PDF/publisher/CORDIS/OpenAIRE/
// institution/government detection - a URL that's bad for image fetching
// is equally bad as a "discovered official source" - and adds the extra
// categories source discovery needs: blog/stock-photo/social-media
// rejection, and the finer-grained allowed types the discovery schema asks
// for (coordinator/consortium/press-release), which URL shape alone can't
// always distinguish from a plain "official_project_website".

import { classifyImageSourceUrl } from "./imageSourceClassifier.mjs";

export const ALLOWED_SOURCE_DISCOVERY_TYPES = [
  "official_project_website",
  "coordinator_project_page",
  "institution_project_page",
  "consortium_page",
  "official_press_release",
  "government_or_funding_page",
  "cordis_project",
  "openaire_project",
];

export const BLOCKED_SOURCE_DISCOVERY_TYPES = [
  "doi_redirect",
  "pdf",
  "publisher_article",
  "random_blog",
  "stock_photo_site",
  "social_media_only",
  "unknown",
];

const BLOG_HOSTNAME_PATTERN = /medium\.com|blogspot\.|wordpress\.com|substack\.com|tumblr\.com|\bblog\./i;
const STOCK_PHOTO_HOSTNAME_PATTERN =
  /shutterstock\.com|istockphoto\.com|gettyimages\.|unsplash\.com|pexels\.com|pixabay\.com|123rf\.com|depositphotos\.com|adobestock\.com/i;
const SOCIAL_MEDIA_HOSTNAME_PATTERN =
  /facebook\.com|twitter\.com|(^|\.)x\.com$|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\./i;
const PRESS_RELEASE_PATH_PATTERN = /\/press-?release|\/news\/|\/media-?centre|\/newsroom/i;

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * @returns {{ category: string, fetchAllowed: boolean, reason: string }}
 */
export function classifySourceDiscoveryUrl(url) {
  const base = classifyImageSourceUrl(url);

  // The shared bad categories (and cordis/openaire/institution/government,
  // which mean the same thing here) pass straight through unchanged.
  if (
    base.category === "doi_redirect" ||
    base.category === "pdf" ||
    base.category === "publisher_article" ||
    base.category === "cordis_project" ||
    base.category === "openaire_project" ||
    base.category === "government_or_funding_page" ||
    base.category === "institution_project_page"
  ) {
    return base;
  }

  const hostname = hostnameOf(url);
  if (!hostname) {
    return { category: "unknown", fetchAllowed: false, reason: "Malformed URL - could not parse a hostname." };
  }

  if (BLOG_HOSTNAME_PATTERN.test(hostname)) {
    return { category: "random_blog", fetchAllowed: false, reason: `Blog-hosting domain (${hostname}) - not an official project source.` };
  }
  if (STOCK_PHOTO_HOSTNAME_PATTERN.test(hostname)) {
    return { category: "stock_photo_site", fetchAllowed: false, reason: `Stock photo site (${hostname}) - never a legitimate project source.` };
  }
  if (SOCIAL_MEDIA_HOSTNAME_PATTERN.test(hostname)) {
    return { category: "social_media_only", fetchAllowed: false, reason: `Social media platform (${hostname}) - not an official standalone project source.` };
  }
  if (PRESS_RELEASE_PATH_PATTERN.test(url)) {
    return { category: "official_press_release", fetchAllowed: true, reason: `URL path suggests an official press release/news page (${hostname}).` };
  }

  // "unknown" from the base classifier (an unrecognised domain that's
  // neither confirmed-good nor confirmed-bad) stays unknown/blocked here
  // too - the spec explicitly lists "unknown" as a blocked type. Nothing
  // is ever assumed to be an "official_project_website" or "consortium_
  // page"/"coordinator_project_page" just because it isn't obviously bad;
  // those categories require actual confirmation (e.g. the record's own
  // curated coordinator field matching the domain), not a URL-shape guess.
  return {
    category: "unknown",
    fetchAllowed: false,
    reason: `Unrecognised domain (${hostname}) - not confirmed as an official project/coordinator/consortium page.`,
  };
}
