import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractWebpage } from "./enrichment/extractWebpage.mjs";
import { buildTriageOutputFiles } from "./triageRecords.mjs";
import { delayMs } from "./http.mjs";
import { classifyImageSourceUrl } from "../processing/imageSourceClassifier.mjs";

// Processes data/processed/image-enrichment-queue.json: for each queued
// record, fetches ITS OWN sourceUrl(s) - never a generic image search -
// and looks for a real, explainable image (the page's own og:image/
// twitter:image, or an inline <img> with real alt text/caption). Nothing
// is ever invented; a record whose page has no usable image stays exactly
// that: pending_image_enrichment, not displayEligible.
//
// Every source URL is classified BEFORE any fetch is attempted
// (classifyImageSourceUrl) - a DOI redirect, a PDF, or a known academic
// publisher's article page is never fetched at all, let alone retried.
// This is a real fix, not a defensive nicety: OpenAlex publication records'
// only source URLs are almost always exactly these three types, and
// fetching them was previously producing repeated 403 retries against
// doi.org/MDPI/Taylor & Francis/RSC for zero possible benefit (those pages
// have no project-specific image to find even when they don't block us).
//
// Every touched file (research-records.json, the three triage outputs,
// image-candidates.json) is written through the same temp-write/validate/
// backup/swap safeguard process:records already uses - a bad or partial
// run can never replace good display data with less/empty data.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");
const rawMediaDir = path.join(rootDir, "data/raw/media-candidates");

const REQUEST_DELAY_MS = 1500;
const MAX_CANDIDATES_PER_RECORD = 5;
const MAX_SOURCE_URLS_PER_RECORD = 2; // don't chase every listed URL - bounded, polite
const DEFAULT_LIMIT = 10;
// Low on purpose - a page that 403s/404s isn't retried at all (see
// http.mjs's RETRYABLE_STATUSES); this only bounds retries for genuinely
// transient conditions (429/500/502/503/504).
const MAX_FETCH_RETRIES = 2;
const SKIP_URL_PATTERN = /favicon|sprite|pixel\.gif|1x1|spacer\.(png|gif)/i;

// Only images actually accepted (see acceptCandidate below) ever become
// image-candidates.json entries or attach to a record's images[] - the
// existing frontend join (researchGalleryData.js) shows every image
// object for a recordId with no further filtering, so a rejected/no-
// context candidate must never be written there in the first place.
function classifyImageType(image) {
  if (image.isMetaImage) return "project_hero";
  const haystack = `${image.altText} ${image.caption} ${image.imageUrl}`.toLowerCase();
  if (/logo|flag|badge/.test(haystack)) return "logo";
  if (/infographic|diagram|chart|scheme|workflow|framework/.test(haystack)) return "infographic";
  if (/vessel|\bship\b|boat|craft|tanker|carrier|bulk carrier/.test(haystack)) return "pilot_vessel";
  if (/hero|banner|cover/.test(haystack)) return "project_hero";
  if (/schematic|render|model|prototype|technical/.test(haystack)) return "technical_visual";
  return "source_preview";
}

// Path-pattern signal for site-wide template assets (programme logos,
// icon sprites, default share-images) - independent of cross-record
// dedup, which only catches genericness when two records IN THE SAME RUN
// happen to share a URL. CORDIS's own "/projects/icons/logo_h2020_big.jpg"
// / "logo_horizon_big.jpg" is exactly this: same path shape, different
// filename per EU funding programme, so a small batch can see only one
// programme's logo and never notice it's shared - this catches it anyway.
const GENERIC_IMAGE_URL_PATTERN = /\/icons?\/|\/logos?\/|logo[-_.]|placeholder|default[-_]image|\bsprite\b/i;

// The relevance gate: an image is only acceptable if there is SOME
// explainable reason to believe it's actually about THIS record - either
// the page owner's own chosen representative image (og:image/twitter:image
// - a real signal, not a guess) or real surrounding text (alt/caption) -
// AND it isn't a recognisable site-wide template/logo asset regardless of
// how convincing its alt text looks (CORDIS auto-generates alt text from
// the page title even for its generic programme logo).
function acceptCandidate(image) {
  if (GENERIC_IMAGE_URL_PATTERN.test(image.imageUrl)) {
    return { accepted: false, reason: "Image URL matches a known template/logo/icon path pattern - a generic programme asset, not a project-specific image." };
  }
  if (image.isMetaImage) {
    return { accepted: true, reason: "Page's own og:image/twitter:image meta tag - the page owner's chosen representative image." };
  }
  if (image.altText) {
    return { accepted: true, reason: `Inline image with real alt text ("${image.altText}").` };
  }
  if (image.caption) {
    return { accepted: true, reason: `Inline image with a real caption ("${image.caption}").` };
  }
  return { accepted: false, reason: "No alt text, caption, or meta-image signal - cannot confirm this image relates to the record." };
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "unknown";
  }
}

function searchMethodFor(url) {
  const host = hostnameOf(url);
  if (host.includes("cordis.europa.eu")) return "official_source_page";
  if (host.includes("openaire.eu")) return "official_source_page";
  return "project_website";
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function newProvenanceSkeleton() {
  return {
    searchMethod: "no_image_found",
    sourcePagesChecked: [],
    sourcePagesAccepted: [],
    sourcePagesRejected: [],
    sourcePagesSkipped: [],
    imageCandidatesFound: [],
    selectedImageCandidates: [],
    selectionCriteria: [
      "official or project-related source",
      "clearly related to the record",
      "has caption or useful surrounding context",
      "not random stock image",
      "source URL is preserved",
      "rights note recorded",
    ],
    finalDecisionReason: "",
    limitations: "Only the record's own listed source URL(s) were checked; no broader web search was performed.",
  };
}

// Phase 1: just fetch and collect raw candidate images - no accept/reject
// decision yet. Deciding per-record in isolation is exactly how a
// site-wide template image (see the CORDIS example above) slips through:
// every CORDIS Horizon project page's og:image is the same generic
// "logo_horizon_big.jpg", and its alt text LOOKS project-specific because
// CORDIS auto-generates it from the page's own <title> - the image itself
// is still not project-specific. Recognising that requires seeing the
// whole batch first (see rejectSharedGenericImages below).
//
// Every URL is classified BEFORE any network call - a blocked one
// (doi_redirect/pdf/publisher_article/unknown) is recorded in
// sourcePagesSkipped and never fetched, let alone retried. queue:image-
// enrichment already only queues records with at least one fetch-allowed
// URL, but a record can still list OTHER, blocked URLs alongside it (e.g.
// a CORDIS page plus its DOI) - those must be skipped here too.
async function fetchRawImagesForRecord(queueItem, log) {
  const allUrls = queueItem.sourceUrls ?? [];
  const provenance = newProvenanceSkeleton();

  if (allUrls.length === 0) {
    provenance.finalDecisionReason = "Record has no sourceUrl to check.";
    return { rawImages: [], provenance, rawResult: null, fetchedUrl: null };
  }

  const classified = allUrls.map((url) => ({ url, ...classifyImageSourceUrl(url) }));
  classified
    .filter((c) => !c.fetchAllowed)
    .forEach((c) => {
      provenance.sourcePagesSkipped.push({ url: c.url, category: c.category, reason: c.reason });
      log(`    skipping ${c.url} (${c.category}, not fetched) - ${c.reason}`);
    });

  const allowedUrls = classified.filter((c) => c.fetchAllowed).map((c) => c.url).slice(0, MAX_SOURCE_URLS_PER_RECORD);

  if (allowedUrls.length === 0) {
    provenance.finalDecisionReason = "No fetch-allowed source URL for this record (all classified as doi_redirect/pdf/publisher_article/unknown).";
    return { rawImages: [], provenance, rawResult: null, fetchedUrl: null };
  }

  let rawResult = null;
  let fetchedUrl = null;
  let fetchError = null;

  for (const url of allowedUrls) {
    provenance.sourcePagesChecked.push(url);
    try {
      rawResult = await extractWebpage(url, { requestDelayMs: REQUEST_DELAY_MS, maxRetries: MAX_FETCH_RETRIES });
      fetchedUrl = url;
      provenance.sourcePagesAccepted.push(url);
      break;
    } catch (error) {
      fetchError = error;
      provenance.sourcePagesRejected.push(url);
      log(`    fetch failed for ${url}: ${error.message}`);
    }
  }

  if (!rawResult) {
    provenance.finalDecisionReason = `All ${allowedUrls.length} fetch-allowed source page(s) failed to fetch (last error: ${fetchError?.message ?? "unknown"}).`;
    return { rawImages: [], provenance, rawResult: null, fetchedUrl: null };
  }

  provenance.searchMethod = searchMethodFor(fetchedUrl);
  const rawImages = rawResult.images.filter((image) => !SKIP_URL_PATTERN.test(image.imageUrl)).slice(0, MAX_CANDIDATES_PER_RECORD);
  provenance.imageCandidatesFound = rawImages.map((image) => image.imageUrl);

  return { rawImages, provenance, rawResult, fetchedUrl };
}

// Phase 2: decide accept/reject with the FULL batch (plus every already-
// accepted image already on file) in view. An image URL claimed by more
// than one distinct record is a shared template/logo/banner asset, not a
// project-specific image, regardless of how convincing its alt text looks
// - rejected outright, before the normal alt-text/caption/meta-image check
// even runs.
function buildSharedUrlCounts(fetchedByRecord, existingImages) {
  const recordIdsByUrl = new Map();
  const note = (imageUrl, recordId) => {
    if (!recordIdsByUrl.has(imageUrl)) recordIdsByUrl.set(imageUrl, new Set());
    recordIdsByUrl.get(imageUrl).add(recordId);
  };
  fetchedByRecord.forEach(({ recordId, rawImages }) => {
    rawImages.forEach((image) => note(image.imageUrl, recordId));
  });
  existingImages.forEach((image) => note(image.imageUrl, image.recordId));
  return recordIdsByUrl;
}

function decideAcceptance({ recordId, rawImages, fetchedUrl, rawResult, sharedUrlCounts, nowIso }) {
  const accepted = [];
  const rejectedReasons = [];

  rawImages.forEach((image) => {
    const usedByOtherRecords = [...(sharedUrlCounts.get(image.imageUrl) ?? [])].some((id) => id !== recordId);
    if (usedByOtherRecords) {
      rejectedReasons.push(`${image.imageUrl}: shared with other unrelated record(s) - a generic/template image, not project-specific.`);
      return;
    }
    const verdict = acceptCandidate(image);
    if (verdict.accepted) {
      accepted.push({ image, reason: verdict.reason });
    } else {
      rejectedReasons.push(`${image.imageUrl}: ${verdict.reason}`);
    }
  });

  if (accepted.length === 0) {
    const reason =
      rawImages.length === 0
        ? `Fetched ${fetchedUrl} successfully but it has no embedded images.`
        : `Fetched ${fetchedUrl} successfully but found ${rawImages.length} image(s), none accepted: ${rejectedReasons.join("; ")}`;
    return { candidates: [], finalDecisionReason: reason };
  }

  const sourceName = rawResult.pageTitle || hostnameOf(fetchedUrl);
  const candidates = accepted.map(({ image, reason }, index) => ({
    imageId: `${recordId}-enrich-${index + 1}`,
    recordId,
    imageUrl: image.imageUrl,
    caption: image.caption || "",
    altText: image.altText || "",
    sourceUrl: fetchedUrl,
    sourceName,
    imageType: classifyImageType(image),
    selected: index === 0,
    selectionReason: index === 0 ? reason : "",
    rejectionReason: "",
    canEmbed: false,
    rightsNote: "Rights not verified; use as linked preview only, do not claim as cleared for reuse.",
    fetchedAt: nowIso,
    origin: "enrich-images",
  }));

  const finalDecisionReason = `Selected 1 of ${candidates.length} accepted candidate(s) from ${fetchedUrl}; ${rejectedReasons.length} candidate(s) rejected.`;
  return { candidates, finalDecisionReason };
}

export async function enrichImages({
  processedDir = defaultProcessedDir,
  limit = DEFAULT_LIMIT,
  nowIso = new Date().toISOString(),
} = {}) {
  const log = (msg) => console.log(msg);

  const queueData = await readJsonIfExists(path.join(processedDir, "image-enrichment-queue.json"), { queue: [] });
  const batch = (queueData.queue ?? []).slice(0, limit);

  const researchRecordsPath = path.join(processedDir, "research-records.json");
  const researchRecordsData = JSON.parse(await fs.readFile(researchRecordsPath, "utf8"));
  const previousRecords = researchRecordsData.records ?? [];
  const recordsById = new Map(previousRecords.map((r) => [r.recordId, r]));

  const existingImageData = await readJsonIfExists(path.join(processedDir, "image-candidates.json"), { images: [] });
  const existingImages = existingImageData.images ?? [];
  const seenImageUrls = new Set(existingImages.map((img) => img.imageUrl));

  await fs.mkdir(rawMediaDir, { recursive: true });

  let attempted = 0;
  let sourcePagesCheckedTotal = 0;
  let sourcePagesSkippedTotal = 0;
  let imageCandidatesFoundTotal = 0;

  // Phase 1: fetch every queued record's page(s) and collect raw
  // candidates only - no accept/reject decision made yet.
  const fetched = [];
  for (const [index, queueItem] of batch.entries()) {
    const record = recordsById.get(queueItem.recordId);
    if (!record) {
      log(`  [${index + 1}/${batch.length}] skip - ${queueItem.recordId} not found in research-records.json`);
      continue;
    }

    attempted++;
    log(`  [${index + 1}/${batch.length}] fetching ${queueItem.recordId} - ${queueItem.title?.slice(0, 60)}`);
    const { rawImages, provenance, rawResult, fetchedUrl } = await fetchRawImagesForRecord(queueItem, log);
    sourcePagesCheckedTotal += provenance.sourcePagesChecked.length;
    sourcePagesSkippedTotal += provenance.sourcePagesSkipped.length;
    imageCandidatesFoundTotal += provenance.imageCandidatesFound.length;

    await fs.writeFile(
      path.join(rawMediaDir, `${queueItem.recordId}.json`),
      `${JSON.stringify(
        {
          recordId: queueItem.recordId,
          fetchedAt: nowIso,
          sourcePagesChecked: provenance.sourcePagesChecked,
          pageTitle: rawResult?.pageTitle ?? null,
          rawImagesConsidered: rawResult?.images?.slice(0, MAX_CANDIDATES_PER_RECORD) ?? [],
        },
        null,
        2
      )}\n`
    );

    fetched.push({ queueItem, record, rawImages, provenance, rawResult, fetchedUrl });

    if (index < batch.length - 1) {
      await delayMs(REQUEST_DELAY_MS);
    }
  }

  // Phase 2: now that every page in this batch has been fetched, decide
  // accept/reject with the full picture - catches a template image shared
  // across several of THIS batch's records, not just ones already on file.
  const sharedUrlCounts = buildSharedUrlCounts(
    fetched.map((f) => ({ recordId: f.queueItem.recordId, rawImages: f.rawImages })),
    existingImages
  );

  let recordsGivenImages = 0;
  const newImages = [];
  const perRecordResults = [];

  for (const { queueItem, record, rawImages, provenance, rawResult, fetchedUrl } of fetched) {
    const { candidates, finalDecisionReason } = fetchedUrl
      ? decideAcceptance({ recordId: queueItem.recordId, rawImages, fetchedUrl, rawResult, sharedUrlCounts, nowIso })
      : { candidates: [], finalDecisionReason: provenance.finalDecisionReason };

    const acceptedNewCandidates = candidates.filter((c) => !seenImageUrls.has(c.imageUrl));
    acceptedNewCandidates.forEach((c) => seenImageUrls.add(c.imageUrl));

    provenance.finalDecisionReason = finalDecisionReason;
    provenance.selectedImageCandidates = acceptedNewCandidates.slice(0, 1).map((c) => c.imageUrl);
    record.lastImageAttemptAt = nowIso;
    record.imageDiscoveryProvenance = provenance;

    if (acceptedNewCandidates.length > 0) {
      record.images = [...(record.images ?? []), ...acceptedNewCandidates];
      record.imageIds = record.images.map((img) => img.imageId);
      record.hasImageCandidates = true;
      record.imageCandidateCount = record.imageIds.length;
      newImages.push(...acceptedNewCandidates);
      recordsGivenImages++;
      log(`  ${queueItem.recordId} -> accepted ${acceptedNewCandidates.length} image candidate(s)`);
    } else {
      log(`  ${queueItem.recordId} -> ${finalDecisionReason}`);
    }

    perRecordResults.push({
      recordId: queueItem.recordId,
      title: queueItem.title,
      sourcePagesChecked: provenance.sourcePagesChecked,
      sourcePagesSkipped: provenance.sourcePagesSkipped,
      imageCandidatesFound: provenance.imageCandidatesFound.length,
      imageCandidatesAccepted: acceptedNewCandidates.length,
      finalDecisionReason,
    });
  }

  // Re-triage against the FULL, updated record set - some of these
  // records may now be displayEligible for the first time.
  const allRecords = [...recordsById.values()];
  const triageFiles = buildTriageOutputFiles(allRecords, { nowIso });

  // Safety invariants before touching any live file - adding images should
  // only ever grow the display-eligible set, never shrink it, and must
  // never lose a record outright.
  const previousDisplayEligibleCount = previousRecords.filter((r) => r.displayEligible).length;
  const newDisplayEligibleCount = triageFiles["display-records.json"].recordCount;
  const validationProblems = [];
  if (allRecords.length !== previousRecords.length) {
    validationProblems.push(`Record count changed from ${previousRecords.length} to ${allRecords.length}.`);
  }
  if (newDisplayEligibleCount < previousDisplayEligibleCount) {
    validationProblems.push(
      `Display-eligible count dropped from ${previousDisplayEligibleCount} to ${newDisplayEligibleCount}.`
    );
  }

  const mergedImages = [...existingImages, ...newImages];
  const imageOutput = {
    generatedAt: nowIso,
    imageCandidateCount: mergedImages.length,
    images: mergedImages,
  };

  const filesToWrite = {
    "research-records.json": { ...researchRecordsData, generatedAt: nowIso, recordCount: allRecords.length, records: allRecords },
    ...triageFiles,
    "image-candidates.json": imageOutput,
  };

  let promoted = false;
  if (validationProblems.length === 0) {
    const runToken = Date.now();
    const tempPaths = Object.fromEntries(
      Object.keys(filesToWrite).map((fileName) => [fileName, path.join(processedDir, `.${fileName}.tmp-${runToken}`)])
    );
    for (const [fileName, content] of Object.entries(filesToWrite)) {
      await fs.writeFile(tempPaths[fileName], `${JSON.stringify(content, null, 2)}\n`);
    }
    for (const fileName of Object.keys(filesToWrite)) {
      const finalPath = path.join(processedDir, fileName);
      const backupPath = path.join(processedDir, `${fileName}.bak`);
      const previousExists = await fs.access(finalPath).then(() => true).catch(() => false);
      if (previousExists) {
        await fs.copyFile(finalPath, backupPath);
      }
      await fs.rename(tempPaths[fileName], finalPath);
    }
    promoted = true;
  } else {
    log("  VALIDATION FAILED - keeping previous research-records.json/display-records.json/image-candidates.json untouched:");
    validationProblems.forEach((p) => log(`    - ${p}`));
  }

  const report = {
    generatedAt: nowIso,
    limit,
    attempted,
    recordsGivenImages,
    recordsStillPending: triageFiles["pending-image-enrichment.json"].recordCount,
    sourcePagesCheckedTotal,
    sourcePagesSkippedTotal,
    imageCandidatesFoundTotal,
    newImageCandidatesWritten: newImages.length,
    promoted,
    validationProblems,
    displayEligibleBefore: previousDisplayEligibleCount,
    displayEligibleAfter: promoted ? newDisplayEligibleCount : previousDisplayEligibleCount,
    entries: perRecordResults,
  };
  await fs.writeFile(
    path.join(processedDir, "image-enrichment-report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );

  return report;
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      args[arg.slice(2)] = true;
    } else {
      args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit ? Number(args.limit) : DEFAULT_LIMIT;
  const result = await enrichImages({ limit });

  console.log("\n" + "=".repeat(60));
  console.log("Image Enrichment Summary");
  console.log("=".repeat(60));
  console.log(`Attempted:                 ${result.attempted}`);
  console.log(`Records given new images:  ${result.recordsGivenImages}`);
  console.log(`Records still pending:     ${result.recordsStillPending}`);
  console.log(`Source pages checked:      ${result.sourcePagesCheckedTotal}`);
  console.log(`Source pages skipped (blocked, never fetched): ${result.sourcePagesSkippedTotal}`);
  console.log(`Image candidates found:    ${result.imageCandidatesFoundTotal}`);
  console.log(`New image candidates kept: ${result.newImageCandidatesWritten}`);
  console.log(`Display eligible: ${result.displayEligibleBefore} -> ${result.displayEligibleAfter}`);
  console.log(`Promoted to live files:    ${result.promoted}`);
  if (result.validationProblems.length) {
    console.log("Validation problems:");
    result.validationProblems.forEach((p) => console.log(`  - ${p}`));
  }
  console.log("=".repeat(60) + "\n");

  if (!result.promoted) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during enrich:images:", error);
    process.exitCode = 1;
  });
}
