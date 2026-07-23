import {
  AI_CURATION_API_URL,
  AI_CURATION_API_KEY,
  AI_CURATION_MODEL,
  isCurationConfigured,
} from "./config.mjs";

/**
 * The ONE function to edit once the real AI API is known. Everything else
 * in curateImages.mjs only depends on this function returning:
 *   { verdict: "suitable" | "unsuitable" | "needs_review", score: number|null, reason: string }
 * - or throwing, which the caller treats as a per-image failure (logged,
 * left as "error" status, never crashes the whole run or hides an image
 * on an API hiccup).
 *
 * We never download or store the image ourselves here - `imageUrl` is
 * passed as a reference for the AI provider's own infrastructure to fetch
 * (the same way a browser would load it to display it, or how a vision
 * API accepts an image URL directly). Nothing beyond the verdict text is
 * persisted locally, consistent with "do not download images by default."
 */
export async function assessImageSuitability(candidate) {
  if (!isCurationConfigured()) {
    return null; // caller treats this as "leave pending"
  }

  const prompt = buildPrompt(candidate);

  // ------------------------------------------------------------------
  // PLACEHOLDER REQUEST - replace this block once the real API endpoint,
  // auth scheme and request shape are known. Shaped generically for now
  // (JSON POST, Bearer auth, one prompt string + an image URL reference).
  // ------------------------------------------------------------------
  const response = await fetch(AI_CURATION_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_CURATION_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_CURATION_MODEL || undefined,
      prompt,
      image_url: candidate.imageUrl,
    }),
  });

  if (!response.ok) {
    throw new Error(`AI curation API returned ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  return parseVerdict(payload);
}

function buildPrompt(candidate) {
  return [
    "You are screening a candidate image for a maritime R&D intelligence dashboard aimed at management.",
    "Decide if this image is suitable to show publicly on a professional research profile page.",
    "",
    `Image URL: ${candidate.imageUrl}`,
    `Caption: ${candidate.caption || "(none)"}`,
    `Alt text: ${candidate.altText || "(none)"}`,
    `Source: ${candidate.sourceName || "unknown"} (${candidate.sourceUrl || "no URL"})`,
    `Declared image type: ${candidate.imageType || "unspecified"}`,
    "",
    "Reject: logos-only images, decorative stock photography unrelated to the actual project,",
    "broken/placeholder images, low-resolution or unprofessional images, anything that reads",
    "as an ad or unrelated marketing banner.",
    "Accept: real project photos, technical diagrams, vessel/port/technology images that",
    "genuinely represent the research described.",
    "",
    'Respond with ONLY a JSON object: {"verdict": "suitable"|"unsuitable"|"needs_review", "score": 0-100, "reason": "one sentence"}',
  ].join("\n");
}

// Providers differ in response shape - tries a few common spots for the
// actual text before giving up. Adjust once the real API's response shape
// is known; everything downstream only cares about the returned object.
function parseVerdict(payload) {
  const text =
    payload.output_text ??
    payload.output?.[0]?.content?.[0]?.text ??
    payload.choices?.[0]?.message?.content ??
    payload.content?.[0]?.text ??
    (typeof payload === "string" ? payload : null);

  if (!text) {
    throw new Error("AI curation API response did not contain a recognisable text field.");
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI curation API response did not contain a JSON verdict.");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const verdict = ["suitable", "unsuitable", "needs_review"].includes(parsed.verdict)
    ? parsed.verdict
    : "needs_review";

  return {
    verdict,
    score: Number.isFinite(parsed.score) ? parsed.score : null,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}
