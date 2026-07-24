import { classifyImageSourceUrl } from "./imageSourceClassifier.mjs";

// ============================================================================
// MOCK ONLY — replace with real AI API later.
// ============================================================================
// This evaluator behaves LIKE the future AI relevance-check API described in
// docs/IMAGE_FETCHING_AND_AI_EVALUATION.md - same input/output shape,
// same decision vocabulary (accept/reject/review) - but every decision here
// comes from deterministic, inspectable rules, not a model call. No API key,
// no network call, no invented judgement: every reason/risk it returns
// traces back to one of the rules below. When a real AI API is available,
// swap the call site (see docs/IMAGE_FETCHING_AND_AI_EVALUATION.md's
// "swap point" note) - the input/output contract is designed to stay the
// same so nothing downstream needs to change.

const HARD_REJECT_PATH_PATTERNS = [
  { pattern: /\/(search|images)\/(search|thumb)/i, reason: "search-result-thumbnail" },
  { pattern: /pixel\.(gif|png)$|\b1x1\b|tracking[-_]?pixel/i, reason: "tracking-pixel" },
  { pattern: /favicon/i, reason: "generic-icon" },
];

const STOCK_SITE_HOSTNAME_PATTERN =
  /shutterstock\.com|istockphoto\.com|gettyimages\.|unsplash\.com|pexels\.com|pixabay\.com|123rf\.com|depositphotos\.com|adobestock\.com|alamy\.com/i;

const SOCIAL_HOSTNAME_PATTERN = /facebook\.com|instagram\.com|(^|\.)x\.com$|twitter\.com|tiktok\.com|pinterest\./i;

const OFFICIAL_PATH_KEYWORD_PATTERN = /\/(logo|campus|about|media|brand|press|news)\b|logo[-_.]|\bbrand\b/i;

const GENERIC_ICON_PATTERN = /\/icons?\/|\bsprite\b|placeholder|default[-_]image|generic[-_]?icon/i;

const WIKIMEDIA_HOSTNAME_PATTERN = /upload\.wikimedia\.org|commons\.wikimedia\.org/i;

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isBase64Url(url) {
  return typeof url === "string" && url.startsWith("data:");
}

const GENERIC_NAME_WORDS = new Set([
  "university",
  "institute",
  "institution",
  "science",
  "sciences",
  "technology",
  "technological",
  "national",
  "international",
  "and",
  "of",
  "the",
]);

// Many official institution domains are acronym-based (ntu.edu.sg, nus.edu.sg,
// srmist.edu.in) rather than spelling the name out - a plain substring check
// alone would wrongly treat those as unofficial. Computed from every
// capitalized word in the name (the conventional way institutions form
// their own acronyms), not just the "significant" words used for the
// substring check below.
function computeAcronym(name) {
  return (name || "")
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]/.test(word))
    .map((word) => word[0])
    .join("")
    .toLowerCase();
}

// Loose, deterministic "does this domain plausibly belong to this
// institution" check - not a DNS/WHOIS lookup (no network here), just a
// name/domain string comparison. A real AI evaluator would ultimately need
// to confirm this the same way; this mock only ever ACCEPTS on a positive
// textual signal, never assumes a domain is official just because nothing
// contradicts it.
function domainLooksOfficial(sourceDomain, targetName) {
  if (!sourceDomain || !targetName) return false;
  const domainLower = sourceDomain.toLowerCase();
  const mainLabel = domainLower.split(".")[0];

  const nameWords = targetName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !GENERIC_NAME_WORDS.has(word));
  if (nameWords.some((word) => domainLower.includes(word))) return true;

  const acronym = computeAcronym(targetName);
  return acronym.length >= 2 && mainLabel === acronym;
}

function textMentionsTarget(text, targetName) {
  if (!text || !targetName) return false;
  const normalizedText = text.toLowerCase();
  const normalizedName = targetName.toLowerCase();
  if (normalizedText.includes(normalizedName)) return true;
  // Acronym check: initials of the target's significant words.
  const acronym = targetName
    .split(/\s+/)
    .filter((word) => /^[A-Z]/.test(word))
    .map((word) => word[0])
    .join("")
    .toLowerCase();
  return acronym.length >= 3 && normalizedText.includes(acronym);
}

/**
 * @param {object} input
 * @param {"institution"|"research-record"} input.targetType
 * @param {string} input.targetName
 * @param {string} [input.country]
 * @param {string} input.candidateImageUrl
 * @param {string} input.imageSourceUrl
 * @param {string} [input.imageAlt]
 * @param {string} [input.imageTitle]
 * @param {string} [input.pageTitle]
 * @param {string} [input.sourceDomain]
 * @param {string} [input.fetchMethod] - "og:image" | "twitter:image" | "schema:logo" | "schema:image" | "link:icon" | "page:img" | "wikimedia"
 * @returns {{ decision: "accept"|"reject"|"review", score: number, reasons: string[], risks: string[], futureAiPromptCompatible: true }}
 */
export function evaluateImageRelevance(input) {
  const {
    targetType = "institution",
    targetName = "",
    candidateImageUrl = "",
    imageSourceUrl = "",
    imageAlt = "",
    imageTitle = "",
    pageTitle = "",
    sourceDomain = hostnameOf(imageSourceUrl) ?? "",
    fetchMethod = "",
  } = input;

  const reasons = [];
  const risks = [];

  // --- Hard rejects: disqualifying regardless of any positive signal. ---
  if (!imageSourceUrl) {
    return reject(["no-provenance: candidate has no source page URL"]);
  }
  if (!/^https?:\/\//i.test(imageSourceUrl) || !/^https?:\/\//i.test(candidateImageUrl || "")) {
    return reject(["invalid-image: source or image URL is not http/https"]);
  }
  if (isBase64Url(candidateImageUrl)) {
    return reject(["invalid-image: base64 data URL, not a fetchable/attributable source"]);
  }

  const classification = classifyImageSourceUrl(imageSourceUrl);
  if (!classification.fetchAllowed && ["doi_redirect", "pdf", "publisher_article"].includes(classification.category)) {
    return reject([`blocked-domain: source page classifies as ${classification.category} (${classification.reason})`]);
  }

  const domain = sourceDomain || hostnameOf(imageSourceUrl) || "";
  if (STOCK_SITE_HOSTNAME_PATTERN.test(domain)) {
    return reject([`blocked-domain: known stock photo site (${domain})`]);
  }
  if (SOCIAL_HOSTNAME_PATTERN.test(domain) && !domainLooksOfficial(domain, targetName)) {
    return reject([`unrelated: social media domain (${domain}) with no official institution link`]);
  }
  for (const { pattern, reason } of HARD_REJECT_PATH_PATTERNS) {
    if (pattern.test(candidateImageUrl) || pattern.test(imageSourceUrl)) {
      return reject([`${reason}: matched path pattern in candidate/source URL`]);
    }
  }
  if (GENERIC_ICON_PATTERN.test(candidateImageUrl)) {
    return reject(["generic-icon: candidate URL matches a generic icon/placeholder path pattern"]);
  }

  // --- Scored signals (additive, 0.0 - 1.0). ---
  let score = 0.2; // baseline: has a real http(s) source page and isn't hard-blocked
  reasons.push("Baseline: real http(s) source page, not on any blocked-domain list.");

  const isOfficialDomain = domainLooksOfficial(domain, targetName);
  if (isOfficialDomain) {
    score += 0.3;
    reasons.push(`Source domain (${domain}) textually matches the target name.`);
  } else {
    risks.push(`Source domain (${domain}) does not obviously match "${targetName}" - official ownership not confirmed by domain alone.`);
  }

  if (fetchMethod === "og:image" || fetchMethod === "twitter:image") {
    score += isOfficialDomain ? 0.25 : 0.1;
    reasons.push(`Image is the page's own ${fetchMethod} meta tag - the page owner's chosen representative image.`);
  } else if (fetchMethod === "schema:logo") {
    score += isOfficialDomain ? 0.25 : 0.1;
    reasons.push("Image is a schema.org logo declaration on the page.");
  } else if (fetchMethod === "schema:image") {
    score += isOfficialDomain ? 0.15 : 0.05;
    reasons.push("Image is a schema.org image declaration on the page.");
  } else if (fetchMethod === "wikimedia") {
    if (WIKIMEDIA_HOSTNAME_PATTERN.test(hostnameOf(candidateImageUrl) ?? "")) {
      score += 0.15;
      reasons.push("Image is hosted on Wikimedia Commons (license/source metadata expected alongside this record).");
      risks.push("Wikimedia Commons image without a directly official source page - treat as review, not automatic accept.");
    } else {
      risks.push("fetchMethod claims wikimedia but candidate image is not actually hosted on upload.wikimedia.org/commons.wikimedia.org.");
    }
  } else if (fetchMethod === "link:icon") {
    score += 0.05;
    risks.push("fetchMethod is link:icon (favicon-tier) - low-confidence signal on its own.");
  } else if (fetchMethod === "page:img") {
    score += isOfficialDomain ? 0.1 : 0.02;
    reasons.push("Image is a plain inline <img> on the source page.");
  }

  if (OFFICIAL_PATH_KEYWORD_PATTERN.test(candidateImageUrl)) {
    score += 0.1;
    reasons.push("Candidate image path contains an official-asset keyword (logo/campus/about/media/brand/press/news).");
  }

  const altOrTitle = `${imageAlt} ${imageTitle}`.trim();
  if (textMentionsTarget(altOrTitle, targetName)) {
    score += 0.15;
    reasons.push(`Image alt/title text mentions "${targetName}" (or its acronym).`);
  } else if (altOrTitle) {
    risks.push("Image alt/title text does not mention the target name or its acronym.");
  } else {
    risks.push("Image has no alt/title text at all.");
  }

  if (textMentionsTarget(pageTitle, targetName)) {
    score += 0.1;
    reasons.push(`Source page title mentions "${targetName}".`);
  } else if (pageTitle) {
    risks.push(`Source page title ("${pageTitle}") does not mention "${targetName}" - page may not be about this target.`);
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(2))));

  let decision;
  if (score >= 0.75) {
    decision = "accept";
  } else if (score >= 0.4) {
    decision = "review";
    risks.push("Score in the review band (0.40-0.74) - accept only after a human (or, later, the real AI API) confirms it.");
  } else {
    decision = "reject";
    risks.push("Score below the review threshold (0.40) - too little positive evidence this image belongs to the target.");
  }

  return {
    decision,
    score,
    reasons,
    risks,
    futureAiPromptCompatible: true,
    targetType,
  };
}

function reject(reasons) {
  return {
    decision: "reject",
    score: 0,
    reasons,
    risks: [],
    futureAiPromptCompatible: true,
  };
}
