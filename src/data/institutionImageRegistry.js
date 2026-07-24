/**
 * Committed registry of institution images the UI is allowed to show.
 *
 * This is hand-promoted from a reviewed run of
 * scripts/ingestion/discoverInstitutionImagesSample.mjs's output
 * (data/processed/test/institution-image-sample.json - test/runtime data,
 * never read by the UI directly - see docs/IMAGE_FETCHING_AND_AI_EVALUATION.md's
 * "Promoting accepted images into UI" section). Only entries the mock
 * evaluator marked "accept" are here; nothing rejected or "review" ever
 * reaches this file, and every field below is copied verbatim from that
 * run's real output - never invented or filled in with a guess.
 *
 * Promoted from run at 2026-07-24T06:34 (all three re-verified with
 * --force to recover full mockAiScore/fetchMethod provenance after an
 * earlier "preserve existing" run had lost it).
 */
export const institutionImageRegistry = [
  {
    institutionName: "Nanyang Technological University",
    institutionSlug: "nanyang-technological-university",
    country: "Singapore",
    assetPath: "/assets/institutions/nanyang-technological-university/image.png",
    imageSourceUrl: "https://www.ntu.edu.sg/",
    imageSourceName: "Home",
    rightsNote: "Source-proven official website image; verify usage rights before commercial redistribution.",
    confidence: "high",
    reason: "Inline <img> on the official ntu.edu.sg homepage whose path/alt text identifies it as the NTU logo.",
    fetchMethod: "page:img",
    mockAiScore: 0.85,
    mockAiDecision: "accept",
    mockAiReason:
      "Baseline: real http(s) source page, not on any blocked-domain list.; Source domain (ntu.edu.sg) textually matches the target name.; Image is a plain inline <img> on the source page.; Candidate image path contains an official-asset keyword (logo/campus/about/media/brand/press/news).; Image alt/title text mentions \"Nanyang Technological University\" (or its acronym).",
    fetchedAt: "2026-07-24T06:34:31.622Z",
  },
  {
    institutionName: "VERKIS HF",
    institutionSlug: "verkis-hf",
    country: "Iceland",
    assetPath: "/assets/institutions/verkis-hf/image.png",
    imageSourceUrl: "https://www.verkis.is/",
    imageSourceName: "Verkís verkfræðistofa | www.verkis.is",
    rightsNote: "Source-proven official website image; verify usage rights before commercial redistribution.",
    confidence: "high",
    reason: "og:image meta tag on the official verkis.is homepage.",
    fetchMethod: "og:image",
    mockAiScore: 0.85,
    mockAiDecision: "accept",
    mockAiReason:
      "Baseline: real http(s) source page, not on any blocked-domain list.; Source domain (verkis.is) textually matches the target name.; Image is the page's own og:image meta tag - the page owner's chosen representative image.",
    fetchedAt: "2026-07-24T06:34:33.988Z",
  },
  {
    institutionName: "Delft University of Technology",
    institutionSlug: "delft-university-of-technology",
    country: "Netherlands",
    assetPath: "/assets/institutions/delft-university-of-technology/image.png",
    imageSourceUrl: "https://www.tudelft.nl/en/",
    imageSourceName: "Delft University of Technology",
    rightsNote: "Source-proven official website image; verify usage rights before commercial redistribution.",
    confidence: "high",
    reason: "og:image meta tag on the official tudelft.nl homepage; page title matches the target name.",
    fetchMethod: "og:image",
    mockAiScore: 0.85,
    mockAiDecision: "accept",
    mockAiReason:
      "Baseline: real http(s) source page, not on any blocked-domain list.; Image is the page's own og:image meta tag - the page owner's chosen representative image.; Source page title mentions \"Delft University of Technology\".",
    fetchedAt: "2026-07-24T06:34:38.230Z",
  },
];

function normalizeName(name) {
  return (name || "").trim().toLowerCase();
}

const bySlug = new Map(institutionImageRegistry.map((entry) => [entry.institutionSlug, entry]));
const byNormalizedName = new Map(institutionImageRegistry.map((entry) => [normalizeName(entry.institutionName), entry]));

/**
 * Exact match only - slug first, then normalized name. No fuzzy matching:
 * an institution with no exact entry here gets no image, never a guessed
 * one (e.g. NTU's image must never attach to another Singapore
 * institution just because they're in the same country).
 */
export function getInstitutionImage({ slug, name } = {}) {
  if (slug && bySlug.has(slug)) return bySlug.get(slug);
  if (name && byNormalizedName.has(normalizeName(name))) return byNormalizedName.get(normalizeName(name));
  return null;
}
