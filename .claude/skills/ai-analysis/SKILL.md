---
name: ai-analysis
description: Implement or modify the post-extraction AI analysis layer (classification, summaries, relevance, digest). Use only for Phase 3 work on goal tracker item 9.
---

# AI Analysis

## Trigger
- Phase 3 work: goal tracker item 9
- Changing analysis prompts, schema, or caching

## Rules (non-negotiable)
- AI runs AFTER extraction only. Never for fetching webpages.
- API keys via environment variables only; never in frontend code,
  never committed, never read from .env by Claude directly.
- Output must be structured JSON with exactly these fields:
  summary, topics, technology, developmentStage, importance,
  relevanceToSMI, relevanceScore, collaborationPotential, risks, evidence.
- Cache results keyed by (contentHash, promptVersion, model).
  Reanalyse only when: source content changes, user explicitly requests,
  or prompt/model version changes.

## Workflow
1. Define/confirm the JSON schema and promptVersion constant.
2. Implement analysis as a separate script stage after buildDataset.
3. Validate every AI response against the schema; reject and log invalid.
4. Store results with cache key; skip cached items on rerun.
5. Verify a rerun with unchanged data makes zero AI calls.

## Completion criteria
- Schema-valid JSON for all analysed records
- Rerun without changes performs zero AI calls (cache proof)
- No secrets in code or logs

## Required report
1. Records analysed vs served from cache
2. Schema validation failures and handling
3. Cost/call count for the run
4. Goal tracker rows to update
