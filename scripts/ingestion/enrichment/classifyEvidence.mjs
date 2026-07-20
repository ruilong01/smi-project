// Plain keyword-rule evidence classification — explicitly NOT an AI call.
// Given a short text chunk, decides a coarse evidenceType and generates a
// short, templated (non-fabricated) "why it matters" line from the matched
// rule. This is the same style of mechanical classification already used
// in scripts/ingestion/normalization.mjs (classifyText/detectTechnologies).

const EVIDENCE_RULES = [
  {
    evidenceType: "funding",
    terms: ["fund", "grant", "invest", "budget", "million", "billion", "$", "financ"],
    whyImportant: "Mentions funding, investment or budget details relevant to this project.",
  },
  {
    evidenceType: "partner",
    terms: ["partner", "collaborat", "consortium", "joint", "agreement", "mou"],
    whyImportant: "Identifies a partnering organisation or collaboration relevant to this project.",
  },
  {
    evidenceType: "result",
    terms: ["result", "reduc", "increas", "improv", "%", "percent", "outcome", "achiev"],
    whyImportant: "States a measurable result or outcome reported for this work.",
  },
  {
    evidenceType: "technology",
    terms: [
      "technology",
      "system",
      "algorithm",
      "sensor",
      "model",
      "platform",
      "architecture",
      "network",
    ],
    whyImportant: "Describes a specific technology or technical approach used.",
  },
  {
    evidenceType: "location",
    terms: ["port of", "singapore", "china", "shanghai", "rotterdam", "based in", "located"],
    whyImportant: "Identifies a specific location relevant to where this work took place.",
  },
  {
    evidenceType: "maturity",
    terms: ["pilot", "trial", "prototype", "deploy", "commercial", "operational", "demonstrat"],
    whyImportant: "Indicates the development/deployment stage of this work.",
  },
  {
    evidenceType: "impact",
    terms: ["emission", "safety", "efficien", "sustainab", "decarbon", "environment"],
    whyImportant: "Describes an expected impact or benefit of this work.",
  },
];

export function classifyEvidenceSnippet(text) {
  const haystack = text.toLowerCase();
  const rule = EVIDENCE_RULES.find((candidate) =>
    candidate.terms.some((term) => haystack.includes(term))
  );

  return {
    evidenceType: rule?.evidenceType ?? "other",
    whyImportant:
      rule?.whyImportant ??
      "Short extracted snippet kept as supporting context for this project.",
  };
}

/**
 * Turns a page's chunks (from chunkText.mjs) into evidence snippets, per
 * the "short snippets only" copyright rule — caps count and reuses the
 * chunk's own short text rather than any longer source material.
 */
export function buildEvidenceSnippets(chunks, sourceUrl, maxSnippets = 5) {
  return chunks.slice(0, maxSnippets).map((chunk) => {
    const { evidenceType, whyImportant } = classifyEvidenceSnippet(chunk.text);
    return {
      text: chunk.text,
      evidenceType,
      whyImportant,
      sourceUrl,
    };
  });
}
