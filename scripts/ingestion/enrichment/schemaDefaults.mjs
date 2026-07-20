// Shared defaults for the AI-Evidence-Selection / AI-Research-Insight data
// model (see CLAUDE.md goal tracker item 9). Every adapter attaches these to
// every project it produces so downstream code (buildDataset, the frontend,
// and the future AI enrichment step) can rely on the fields always existing,
// even before enrichment/AI has run.

export function emptyDataQuality() {
  return {
    hasOriginalSource: false,
    hasOfficialSource: false,
    evidenceCount: 0,
    imageCandidateCount: 0,
    needsManualReview: true,
    lastAnalysedAt: null,
  };
}

export function emptyAiFields() {
  return {
    sourcePages: [],
    selectedEvidence: [],
    aiAnalysis: null,
    dataQuality: emptyDataQuality(),
  };
}
