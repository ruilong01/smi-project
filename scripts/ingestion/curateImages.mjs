import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isCurationConfigured, AI_CURATION_MODEL } from "./aiCuration/config.mjs";
import { assessImageSuitability } from "./aiCuration/client.mjs";
import { shouldHideImage } from "./aiCuration/verdict.mjs";
import { delayMs } from "./http.mjs";

// Screens every image candidate in data/processed/image-candidates.json
// through the AI curation API (see aiCuration/client.mjs) and applies the
// verdict to whatever currently embeds those same image URLs - today,
// project.sourcePages[].images[] inside the legacy dataset the frontend
// actually bundles.
//
// Safe to run before the real API link/key exist: with neither set, this
// is a no-op that just marks every candidate "pending" (identical to
// today's behaviour - nothing hidden, nothing changed). Once
// AI_CURATION_API_URL and AI_CURATION_API_KEY are set, re-run this and it
// starts hiding whatever the AI verdicts "unsuitable"/"needs_review" or
// scores below AI_CURATION_MIN_SCORE - never on "pending" or "error", so
// an API hiccup can never silently empty the image gallery.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const imageCandidatesPath = path.join(rootDir, "data/processed/image-candidates.json");
const legacyDatasetPath = path.join(rootDir, "src/data/generated/liveResearchData.json");
const REQUEST_DELAY_MS = 500;

function defaultCuration(reason) {
  return {
    status: "pending",
    verdict: null,
    score: null,
    reason,
    assessedAt: null,
    model: null,
  };
}

// Applies verdicts by pruning matching imageUrls out of the legacy
// dataset's embedded sourcePages[].images[]. Removing at the data layer
// means the frontend needs zero new code: the existing "image candidate
// not available yet" / "no verified project image" fallbacks already
// handle an image being absent.
async function applyToLegacyDataset(curatedImages) {
  let dataset;
  try {
    dataset = JSON.parse(await fs.readFile(legacyDatasetPath, "utf8"));
  } catch {
    return 0; // legacy dataset not present - nothing to prune
  }

  const hideByUrl = new Set(
    curatedImages.filter((image) => shouldHideImage(image.aiCuration)).map((image) => image.imageUrl)
  );
  if (hideByUrl.size === 0) {
    return 0;
  }

  let hiddenCount = 0;
  (dataset.projects ?? []).forEach((project) => {
    (project.sourcePages ?? []).forEach((sourcePage) => {
      const before = sourcePage.images?.length ?? 0;
      sourcePage.images = (sourcePage.images ?? []).filter(
        (image) => !hideByUrl.has(image.imageUrl)
      );
      hiddenCount += before - sourcePage.images.length;
    });
  });

  if (hiddenCount > 0) {
    await fs.writeFile(legacyDatasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
  }
  return hiddenCount;
}

export async function curateImages({ force = false } = {}) {
  const nowIso = new Date().toISOString();
  const data = JSON.parse(await fs.readFile(imageCandidatesPath, "utf8"));
  const images = data.images ?? [];

  if (!isCurationConfigured()) {
    console.log(
      "[curate:images] AI_CURATION_API_URL / AI_CURATION_API_KEY not set - leaving all candidates 'pending'. Nothing hidden, nothing changed from today's behaviour."
    );
    images.forEach((image) => {
      if (!image.aiCuration) {
        image.aiCuration = defaultCuration(
          "AI curation API not configured yet (set AI_CURATION_API_URL / AI_CURATION_API_KEY)."
        );
      }
    });
    await fs.writeFile(imageCandidatesPath, `${JSON.stringify(data, null, 2)}\n`);
    return { configured: false, assessed: 0, errors: 0, hidden: 0, total: images.length };
  }

  let assessedCount = 0;
  let errorCount = 0;

  for (const image of images) {
    if (image.aiCuration?.status === "assessed" && !force) {
      continue; // already assessed - skip re-spending API calls unless --force
    }
    try {
      const result = await assessImageSuitability(image);
      image.aiCuration = {
        status: "assessed",
        verdict: result.verdict,
        score: result.score,
        reason: result.reason,
        assessedAt: nowIso,
        model: AI_CURATION_MODEL || null,
      };
      assessedCount++;
      console.log(`[curate:images] ${image.imageId}: ${result.verdict} (score ${result.score ?? "n/a"})`);
    } catch (error) {
      errorCount++;
      image.aiCuration = {
        status: "error",
        verdict: null,
        score: null,
        reason: error.message,
        assessedAt: nowIso,
        model: AI_CURATION_MODEL || null,
      };
      console.warn(`[curate:images] ${image.imageId} failed: ${error.message}`);
    }
    await delayMs(REQUEST_DELAY_MS);
  }

  await fs.writeFile(imageCandidatesPath, `${JSON.stringify(data, null, 2)}\n`);

  const hiddenCount = await applyToLegacyDataset(images);

  console.log(
    `[curate:images] assessed ${assessedCount} (${errorCount} errors), ${hiddenCount} image(s) hidden from the legacy dataset.`
  );
  return { configured: true, assessed: assessedCount, errors: errorCount, hidden: hiddenCount, total: images.length };
}

async function main() {
  const force = process.argv.includes("--force");
  await curateImages({ force });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during image curation:", error.message);
    process.exitCode = 1;
  });
}
