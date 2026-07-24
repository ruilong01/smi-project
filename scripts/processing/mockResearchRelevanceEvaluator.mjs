import { OPENALEX_EXCLUDE_TERMS } from "../ingestion/config.mjs";

// ============================================================================
// MOCK ONLY — replace with real AI API later.
// ============================================================================
// Deterministic maritime-relevance scoring for the open-access PDF
// discovery pipeline (scripts/ingestion/discoverOpenAccessPdfs.mjs, see
// docs/OPEN_ACCESS_PDF_INGESTION.md). Same shape/spirit as
// mockImageRelevanceEvaluator.mjs: no API key, no network call, every
// decision traces back to one of the rules below. Swap the call site for a
// real AI relevance check later without changing the input/output contract.

const MARITIME_TERMS = [
  "maritime",
  "port",
  "vessel",
  "ocean",
  "marine",
  "shipping",
  "ship",
  "seafarer",
  "offshore",
  "naval",
  "harbour",
  "harbor",
  "ballast",
  "bunkering",
  "cargo",
  "container terminal",
  "coastal",
  "underwater",
  "autonomous vessel",
  "autonomous ship",
  "unmanned surface",
  "auv",
  "rov",
  "hydrographic",
  "seaport",
  "dock",
  "berth",
  "wave energy",
  "tidal energy",
];

function normalize(text) {
  return (text || "").toLowerCase();
}

function findMatchedTerms(haystack) {
  return MARITIME_TERMS.filter((term) => haystack.includes(term));
}

function reject(reason, extra = {}) {
  return { decision: "reject", score: 0, reason, matchedTerms: [], risks: [], ...extra };
}

/**
 * @param {object} input
 * @param {string} input.title
 * @param {string} [input.abstract]
 * @param {string[]} [input.topics]
 * @param {string} [input.matchedQueryTopic] - the search term/topic this candidate was found via, if it's one of this pipeline's own maritime topic queries
 * @param {string} input.sourceUrl
 * @param {"high"|"medium"|"low"} [input.sourceCredibilityTier]
 * @param {boolean} input.isOpenAccess
 * @param {string} [input.oaEvidence]
 * @param {string} [input.institution]
 * @param {string} [input.country]
 * @returns {{ decision: "accept"|"reject"|"review", score: number, reason: string, matchedTerms: string[], risks: string[] }}
 */
export function evaluateResearchRelevance(input) {
  const {
    title = "",
    abstract = "",
    topics = [],
    matchedQueryTopic = "",
    sourceUrl = "",
    sourceCredibilityTier = "low",
    isOpenAccess = false,
    oaEvidence = "",
    institution = "",
    country = "",
  } = input;

  if (!title) {
    return reject("no-title: candidate has no title.");
  }
  if (!sourceUrl) {
    return reject("no-source-url: candidate has no source URL.");
  }
  if (!isOpenAccess || !oaEvidence) {
    return reject("no-oa-evidence: candidate has no confirmed legal open-access evidence.");
  }

  const haystack = normalize([title, abstract, ...topics].join(" "));
  const matchedTerms = findMatchedTerms(haystack);
  const matchedExcludeTerm = OPENALEX_EXCLUDE_TERMS.find((term) => haystack.includes(term.toLowerCase()));

  if (matchedTerms.length === 0) {
    return reject("no-maritime-terms: title/abstract/topics contain no recognized maritime/ocean/port/vessel term.");
  }
  if (matchedExcludeTerm && matchedTerms.length === 1 && haystack.includes(matchedExcludeTerm.toLowerCase())) {
    // A single, weak maritime-term match (typically just "shipping") next to
    // a known false-positive phrase (e.g. "e-commerce shipping") is treated
    // as unrelated rather than a real maritime paper - same false-positive
    // list already used by discoverResearchGlobal's OpenAlex sweep.
    return reject(`unrelated: matched known false-positive phrase "${matchedExcludeTerm}" with no other maritime signal.`);
  }

  const risks = [];
  let score = 0.15;

  const termBonus = Math.min(0.3, matchedTerms.length * 0.08);
  score += termBonus;

  if (matchedTerms.length >= 3) {
    score += 0.1;
  } else {
    risks.push(`Only ${matchedTerms.length} maritime term(s) matched (${matchedTerms.join(", ")}) - weak topical signal.`);
  }

  if (matchedQueryTopic) {
    score += 0.15;
  } else {
    risks.push("Not discovered via one of this pipeline's own maritime topic queries.");
  }

  if (institution && institution.toLowerCase() !== "unknown") {
    score += 0.1;
  } else {
    risks.push("No institution metadata.");
  }

  if (country && country.toLowerCase() !== "unknown") {
    score += 0.1;
  } else {
    risks.push("No country metadata.");
  }

  if (sourceCredibilityTier === "high") {
    score += 0.15;
  } else if (sourceCredibilityTier === "medium") {
    score += 0.08;
  } else {
    risks.push(`Source credibility tier is "${sourceCredibilityTier}".`);
  }

  score = Math.max(0, Math.min(1, Number(score.toFixed(2))));

  let decision;
  if (score >= 0.7) {
    decision = "accept";
  } else if (score >= 0.4) {
    decision = "review";
    risks.push("Score in the review band (0.40-0.69) - accept only after human (or later, real AI) confirmation.");
  } else {
    decision = "reject";
    risks.push("Score below the review threshold (0.40) - too little positive maritime-relevance evidence.");
  }

  return {
    decision,
    score,
    reason: `Matched ${matchedTerms.length} maritime term(s); credibility=${sourceCredibilityTier}; ${matchedQueryTopic ? "found via topic query" : "not from a topic query"}.`,
    matchedTerms,
    risks,
  };
}
