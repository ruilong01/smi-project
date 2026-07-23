// AI image-curation API config. Nothing here is hardcoded - set these as
// environment variables (server .env, never committed) once the real API
// is available.
//
// Until AI_CURATION_API_URL and AI_CURATION_API_KEY are BOTH set,
// curateImages.mjs runs in "not configured" mode: every image candidate
// stays "pending" (shown exactly as it is today - no image is hidden,
// nothing errors, nothing changes). This is the placeholder the rest of
// the pipeline is safe to ship against before the real link exists.
export const AI_CURATION_API_URL = process.env.AI_CURATION_API_URL || "";
export const AI_CURATION_API_KEY = process.env.AI_CURATION_API_KEY || "";
export const AI_CURATION_MODEL = process.env.AI_CURATION_MODEL || "";

// Images with a numeric score below this are treated as unsuitable, in
// addition to any image the API explicitly verdicts "unsuitable" or
// "needs_review". Tune via env once real scores start coming back.
export const AI_CURATION_MIN_SCORE = Number(process.env.AI_CURATION_MIN_SCORE ?? 60);

export function isCurationConfigured() {
  return Boolean(AI_CURATION_API_URL && AI_CURATION_API_KEY);
}
