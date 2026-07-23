# AI image curation

How the app will screen candidate images through an AI API before they're
shown, and exactly what to do once the real API link/key exist.

## What's built, and why it's safe to ship before the API exists

Nothing in this feature can change what the app shows until two environment
variables are both set: `AI_CURATION_API_URL` and `AI_CURATION_API_KEY`.
With either unset, `npm run curate:images` is a complete no-op — every
image candidate is marked `"pending"` and the app behaves exactly as it
does today. There is no hidden default-on behavior.

```
data/processed/image-candidates.json  (each image, unassessed)
  -> npm run curate:images
  -> AI curation API judges each candidate
  -> verdict written back onto the same image-candidates.json entry
  -> "unsuitable"/"needs_review"/low-score images pruned from
     project.sourcePages[].images[] inside src/data/generated/liveResearchData.json
  -> frontend's existing "no image available" fallback (already built)
     covers everything that got pruned - zero new frontend code needed
```

## What you need to give me

Two things, whenever you have them:

1. **The API endpoint URL and key.** Set them as environment variables
   (never commit them):
   ```bash
   export AI_CURATION_API_URL="https://your-api.example.com/v1/assess"
   export AI_CURATION_API_KEY="sk-..."
   export AI_CURATION_MODEL="whatever-model-name"   # optional
   ```
   Or add them to the server's `.env` file (see `docs/AWS_DATA_REFRESH.md`
   §4 for where that lives on the AWS box).

2. **The actual request/response shape**, if it's not a simple
   `POST {prompt, image_url} -> {verdict, score, reason}` JSON API (which
   is what's stubbed in right now). Tell me the provider (Anthropic,
   OpenAI, a custom internal service, etc.) and I'll adjust exactly one
   function.

## Exactly what to edit once you have the real API

Everything about the actual HTTP call lives in **one file**:
[`scripts/ingestion/aiCuration/client.mjs`](../scripts/ingestion/aiCuration/client.mjs),
in the `assessImageSuitability()` function. It currently:

1. Builds a text prompt describing the image (URL, caption, alt text,
   source, declared type) and asks for a suitability verdict.
2. POSTs it to `AI_CURATION_API_URL` with a Bearer token, as a placeholder
   request shape.
3. Parses a handful of common response shapes (`output_text`,
   `choices[0].message.content`, etc.) looking for a JSON object like
   `{"verdict": "suitable", "score": 85, "reason": "..."}`.

Nothing outside this file needs to change — `curateImages.mjs`,
`ingestMediaSeed.mjs`, and the frontend only depend on this function
returning `{ verdict, score, reason }` (or throwing, which is handled as a
per-image failure, never a crash).

If the real API is vision-capable and can accept an image URL directly
(most modern ones can), pass `candidate.imageUrl` as an image input instead
of just a text reference — the comment in that file marks where.

## Running it

```bash
npm run curate:images            # assess only images without a verdict yet
npm run curate:images -- --force # re-assess everything, including already-verdicted images
```

(`npm.cmd run curate:images` on Windows.)

## Verdict states and what they mean for display

| Status | Meaning | Shown on the site? |
|---|---|---|
| `pending` | Not assessed yet (API not configured, or new candidate) | Yes — current behavior, unchanged |
| `assessed` + `suitable` | AI approved it | Yes |
| `assessed` + `unsuitable` | AI rejected it | No — pruned, falls back to "no image available" |
| `assessed` + `needs_review` | AI wasn't confident | No — pruned (conservative default; see below) |
| `assessed` with `score < AI_CURATION_MIN_SCORE` (default 60) | Below quality threshold | No — pruned |
| `error` | API call failed for this image | Yes — never hidden on an API hiccup |

Tune the score cutoff via `AI_CURATION_MIN_SCORE` (env var, default `60`).

**Deliberate design choice**: only an explicit, successful `"assessed"`
verdict can ever hide an image. `"pending"` and `"error"` always keep
current behavior. This means a flaky or misconfigured API can never
silently empty out the image gallery — the worst case is images just
don't get curated yet, not that they vanish.

## Where verdicts are stored, and why they survive re-runs

Verdicts live directly on each entry in `data/processed/image-candidates.json`
(`aiCuration: { status, verdict, score, reason, assessedAt, model }`).
Both `npm run ingest:media-seed` (which rebuilds this file from the seed
every run) and `npm run curate:images` know to preserve existing verdicts
by `imageId` — re-running the seed import will never resurrect an image
that was already marked unsuitable, and re-running curation skips
already-assessed images unless you pass `--force`.

## Current scope

Only the CORDIS media-seed images have any candidates to curate today —
OpenAlex/Crossref are metadata-only APIs with no images, so there's nothing
for this to screen there yet. As soon as an image-fetching source exists
for those records, its candidates flow through the same
`data/processed/image-candidates.json` file and get curated the same way,
with no changes needed to this pipeline.
