import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractWebpage } from "./enrichment/extractWebpage.mjs";
import { delayMs } from "./http.mjs";

// Attempts to find real, project-related images for records in
// data/processed/enrichment-queue.json (built by queue:enrichment), by
// fetching each record's OWN sourceUrl - which in this dataset always IS
// the official page (a CORDIS project page, an institution/coordinator
// page, or the publisher's own landing page for OpenAlex records) - never
// a generic image search. Only <img> tags actually present on that one
// page are ever considered; nothing is ever substituted from elsewhere.
//
// Every attempt (successful or not) is recorded via lastImageAttemptAt so
// queue:enrichment's cooldown keeps a blocked/imageless page from being
// re-hit on every single incremental run.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");

const REQUEST_DELAY_MS = 1500;
const MAX_IMAGES_PER_RECORD = 5;
const SKIP_URL_PATTERN = /favicon|sprite|pixel\.gif|1x1|spacer\.(png|gif)/i;
const DEFAULT_BATCH_LIMIT = Number(process.env.ENRICH_IMAGES_BATCH_LIMIT ?? 20);

function classifyImageType(image) {
  const haystack = `${image.altText} ${image.caption} ${image.imageUrl}`.toLowerCase();
  if (/logo|flag|badge/.test(haystack)) return "logo";
  if (/infographic|diagram|chart|scheme|workflow|framework/.test(haystack)) return "infographic";
  if (/vessel|\bship\b|boat|craft|tanker|carrier|bulk carrier/.test(haystack)) return "pilot_vessel";
  if (/hero|banner|cover/.test(haystack)) return "project_hero";
  if (/schematic|render|model|prototype|technical/.test(haystack)) return "technical_visual";
  return "source_preview";
}

async function readJsonIfExists(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export async function enrichImages({
  processedDir = defaultProcessedDir,
  batchLimit = DEFAULT_BATCH_LIMIT,
  nowIso = new Date().toISOString(),
} = {}) {
  const researchRecordsPath = path.join(processedDir, "research-records.json");
  const imageCandidatesPath = path.join(processedDir, "image-candidates.json");
  const queueData = await readJsonIfExists(path.join(processedDir, "enrichment-queue.json"), { queue: [] });
  const batch = (queueData.queue ?? []).slice(0, batchLimit);

  const researchRecordsData = JSON.parse(await fs.readFile(researchRecordsPath, "utf8"));
  const recordsById = new Map(researchRecordsData.records.map((r) => [r.recordId, r]));

  const imageData = await readJsonIfExists(imageCandidatesPath, { images: [] });
  const existingImages = imageData.images ?? [];
  const seenImageUrls = new Set(existingImages.map((img) => img.imageUrl));

  let found = 0;
  let notFound = 0;
  let errors = 0;
  const newImages = [];

  for (const [index, item] of batch.entries()) {
    const record = recordsById.get(item.recordId);
    if (!record) continue;

    try {
      const result = await extractWebpage(item.sourceUrl, { requestDelayMs: REQUEST_DELAY_MS });
      const candidateImages = result.images
        .filter((image) => !SKIP_URL_PATTERN.test(image.imageUrl))
        .filter((image) => !seenImageUrls.has(image.imageUrl))
        .slice(0, MAX_IMAGES_PER_RECORD);

      if (candidateImages.length === 0) {
        notFound++;
        console.log(`  [${index + 1}/${batch.length}] no usable images: ${item.title?.slice(0, 60)}`);
      } else {
        const sourceName = result.pageTitle || new URL(item.sourceUrl).hostname;
        const recordImages = candidateImages.map((image, i) => {
          seenImageUrls.add(image.imageUrl);
          return {
            imageId: `${item.recordId}-enrich-${i + 1}`,
            recordId: item.recordId,
            imageUrl: image.imageUrl,
            caption: image.caption || "",
            altText: image.altText || "",
            sourceUrl: item.sourceUrl,
            sourceName,
            imageType: classifyImageType(image),
            selected: i === 0,
            selectionReason:
              i === 0
                ? "First real image found on the record's own official source page."
                : "Additional candidate from the same official source page; not selected as primary.",
            canEmbed: false,
            rightsNote: "Rights not verified; use as linked preview only, do not claim as cleared for reuse.",
            fetchedAt: nowIso,
            origin: "enrich-images",
          };
        });
        newImages.push(...recordImages);

        record.images = [...(record.images ?? []), ...recordImages];
        record.imageIds = record.images.map((img) => img.imageId);
        record.hasImageCandidates = true;
        record.imageCandidateCount = record.imageIds.length;

        found++;
        console.log(`  [${index + 1}/${batch.length}] ✓ ${recordImages.length} image(s): ${item.title?.slice(0, 60)}`);
      }
    } catch (error) {
      errors++;
      console.warn(`  [${index + 1}/${batch.length}] ✗ ${item.title?.slice(0, 60)} - ${error.message}`);
    }

    record.lastImageAttemptAt = nowIso;

    if (index < batch.length - 1) {
      await delayMs(REQUEST_DELAY_MS);
    }
  }

  if (newImages.length > 0) {
    await fs.writeFile(
      imageCandidatesPath,
      `${JSON.stringify(
        { generatedAt: nowIso, imageCandidateCount: existingImages.length + newImages.length, images: [...existingImages, ...newImages] },
        null,
        2
      )}\n`
    );
  }

  if (batch.length > 0) {
    await fs.writeFile(researchRecordsPath, `${JSON.stringify(researchRecordsData, null, 2)}\n`);
  }

  return { attempted: batch.length, found, notFound, errors, newImageCount: newImages.length };
}

async function main() {
  const result = await enrichImages();
  console.log("\n" + "=".repeat(60));
  console.log("Image Enrichment Summary");
  console.log("=".repeat(60));
  console.log(`Attempted:        ${result.attempted}`);
  console.log(`Records with new images: ${result.found}`);
  console.log(`No images found:  ${result.notFound}`);
  console.log(`Errors:           ${result.errors}`);
  console.log(`New image candidates written: ${result.newImageCount}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during enrich:images:", error);
    process.exitCode = 1;
  });
}
