/**
 * Committed registry of institution images the UI is allowed to show.
 *
 * Hand-promoted from reviewed runs of
 * scripts/ingestion/discoverInstitutionImages.mjs's output
 * (data/processed/test/institution-image-discovery.json - test/runtime
 * data, never read by the UI directly - see
 * docs/IMAGE_FETCHING_AND_AI_EVALUATION.md's "Promoting accepted images
 * into UI" section). Only entries the mock evaluator marked "accept" are
 * here; nothing rejected or "review" ever reaches this file, and every
 * field below is copied verbatim from that run's real output - never
 * invented or filled in with a guess.
 *
 * imageType priority (landmark-building > campus > hero > wikimedia >
 * logo > fallback, see docs/IMAGE_FETCHING_AND_AI_EVALUATION.md) - NTU's
 * entry was upgraded from a plain logo to a real landmark building photo
 * ("The Hive", NTU's own about-us page og:image) once
 * discoverInstitutionImages.mjs's multi-page search found it; VERKIS and
 * Delft are still logo/hero fallbacks because no better candidate was
 * found on their homepages in this run - not because logos were preferred.
 */
export const institutionImageRegistry = [
  {
    institutionName: "Nanyang Technological University",
    institutionSlug: "nanyang-technological-university",
    country: "Singapore",
    assetPath: "/assets/institutions/nanyang-technological-university/image.jpg",
    imageSourceUrl: "https://www.ntu.edu.sg/about-us",
    imageSourceName: "About Us | Vision and Mission",
    rightsNote: "Source-proven official website image; verify usage rights before commercial redistribution.",
    imageType: "hero",
    confidence: "high",
    reason:
      "og:image on NTU's own official about-us page - a real photo of The Hive, one of NTU's iconic landmark buildings, found by discoverInstitutionImages.mjs's multi-page search. Upgraded from an earlier plain-logo entry (see git history).",
    fetchMethod: "og:image",
    mockAiScore: 0.89,
    mockAiDecision: "accept",
    mockAiReason:
      "Baseline: real http(s) source page, not on any blocked-domain list.; Source domain (ntu.edu.sg) textually matches the target name.; Image is the page's own og:image meta tag - the page owner's chosen representative image.; Image type classified as \"hero\" (+0.14) - landmark/campus images are prioritized well above a plain logo.",
    fetchedAt: "2026-07-24T07:36:49.933Z",
  },
  {
    institutionName: "VERKIS HF",
    institutionSlug: "verkis-hf",
    country: "Iceland",
    assetPath: "/assets/institutions/verkis-hf/image.png",
    imageSourceUrl: "https://www.verkis.is/",
    imageSourceName: "Verkís verkfræðistofa | www.verkis.is",
    rightsNote: "Source-proven official website image; verify usage rights before commercial redistribution.",
    imageType: "logo",
    confidence: "high",
    reason:
      "og:image meta tag on the official verkis.is homepage - a logo. No landmark/campus image was found on the homepage or the guessed about/campus/media sub-pages (all 404'd); kept as a fallback per the landmark-over-logo policy, not a preferred choice.",
    fetchMethod: "og:image",
    mockAiScore: 0.85,
    mockAiDecision: "accept",
    mockAiReason:
      "Baseline: real http(s) source page, not on any blocked-domain list.; Source domain (verkis.is) textually matches the target name.; Image is the page's own og:image meta tag - the page owner's chosen representative image.; Image type classified as \"logo\" (+0.04) - landmark/campus images are prioritized well above a plain logo.",
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
    imageType: "hero",
    confidence: "high",
    reason:
      "og:image meta tag on the official tudelft.nl homepage (an event graphic, not a logo or a landmark photo). No landmark/campus image was found on the guessed about/campus/media sub-pages (all 404'd).",
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
