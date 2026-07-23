import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { fetchText, delayMs, buildUserAgent } from "./http.mjs";
import { OPENALEX_EMAIL } from "./config.mjs";

// Fetches a real preview image for OpenAlex-derived RESEARCH_PAPER projects
// in src/data/generated/liveResearchData.json, which - unlike the CORDIS
// media-seed projects - never had any image source at all (the legacy
// openalex.adapter.mjs always sets project.images: [] and never builds a
// sourcePages entry). No AI or crawling here: one plain HTTP GET of the
// paper's own landing page per record, reading only the publisher's own
// Open Graph / Twitter Card meta tags - the same tags that site already
// hands to Facebook/Twitter/Slack link previews. If a page has no such tag,
// or the extracted URL doesn't actually resolve to an image, the record is
// left with no image - never a fabricated one.
//
// Images land in project.sourcePages[].images[], the same "rights not
// verified, source preview only" slot ProjectDetail.jsx already renders
// for the CORDIS media-seed records - NOT project.images[] (the hero-image
// slot), which ProjectDetail.jsx only treats as "verified" when a real
// image.licence is present, and no licence has actually been cleared here.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const datasetPath = path.join(rootDir, "src/data/generated/liveResearchData.json");

const REQUEST_DELAY_MS = 1200;
const FETCH_TIMEOUT_MS = 10000;

// Priority order: secure_url first, then plain og:image, then Twitter Card
// fallbacks for sites that only set those.
const OG_IMAGE_SELECTORS = [
  'meta[property="og:image:secure_url"]',
  'meta[property="og:image"]',
  'meta[name="twitter:image"]',
  'meta[name="twitter:image:src"]',
];

function landingUrlForProject(project) {
  return project.openAlex?.primaryLocationUrl || project.openAlex?.openAccessUrl || null;
}

async function extractOgImageUrl(pageUrl) {
  const html = await fetchText(pageUrl, {
    fetchOptions: {
      email: OPENALEX_EMAIL,
      timeout: FETCH_TIMEOUT_MS,
      retries: 2,
      requestDelay: REQUEST_DELAY_MS,
    },
  });
  const $ = cheerio.load(html);

  for (const selector of OG_IMAGE_SELECTORS) {
    const content = $(selector).attr("content");
    if (content) {
      try {
        return new URL(content, pageUrl).toString();
      } catch {
        // Malformed URL in the page's own metadata - try the next tag.
      }
    }
  }
  return null;
}

// Never trust the tag content alone - some publisher pages set og:image to
// a broken/placeholder path. Confirm it actually resolves to a real image
// before recording it as a candidate.
async function imageUrlResolves(imageUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(imageUrl, {
      method: "HEAD",
      signal: controller.signal,
      headers: { "User-Agent": buildUserAgent(OPENALEX_EMAIL) },
    });
    clearTimeout(timeoutId);
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type") ?? "";
    return contentType.startsWith("image/");
  } catch {
    return false;
  }
}

function buildSourcePagesWithImage(project, landingUrl, imageUrl, nowIso) {
  let hostname = "publisher";
  try {
    hostname = new URL(landingUrl).hostname;
  } catch {
    // keep the "publisher" fallback
  }

  return [
    {
      sourceId: `sourcepage-publication-image-${project.id}`,
      sourceType: "publisher-og-image",
      sourceName: hostname,
      sourceUrl: landingUrl,
      pageTitle: project.title,
      publishedDate: nowIso,
      fetchedAt: nowIso,
      rawTextStored: false,
      cleanedTextSummary: "",
      chunks: [],
      images: [
        {
          imageUrl,
          altText: project.title,
          caption: "",
          sourceUrl: landingUrl,
          canEmbed: false,
          rightsNote:
            "Publisher-provided preview image (Open Graph meta tag); rights not verified, do not claim as cleared for reuse.",
        },
      ],
    },
  ];
}

async function main() {
  const nowIso = new Date().toISOString();
  const raw = await fs.readFile(datasetPath, "utf8");
  const dataset = JSON.parse(raw);

  // Skip anything that already has a sourcePages entry (from a previous run
  // of this same script) - idempotent by default so re-running doesn't
  // re-hit hundreds of external domains for records that already
  // succeeded. project.images is NOT a useful signal here: buildDataset.mjs
  // always pads every project's images[] with a placeholder object
  // (imageType: "placeholder", url: "") when it has no real image, so it is
  // never actually empty by the time this file is written.
  const candidates = dataset.projects.filter(
    (project) =>
      project.entityType === "RESEARCH_PAPER" &&
      !(project.sourcePages?.length) &&
      landingUrlForProject(project)
  );

  console.log(`[fetch:publication-images] ${candidates.length} publication record(s) with no image yet.`);

  let found = 0;
  let notFound = 0;
  let errors = 0;

  for (const [index, project] of candidates.entries()) {
    const landingUrl = landingUrlForProject(project);
    try {
      const ogImageUrl = await extractOgImageUrl(landingUrl);
      if (ogImageUrl && (await imageUrlResolves(ogImageUrl))) {
        project.sourcePages = buildSourcePagesWithImage(project, landingUrl, ogImageUrl, nowIso);
        found++;
        console.log(`  [${index + 1}/${candidates.length}] ✓ ${project.title.slice(0, 70)}`);
      } else {
        notFound++;
      }
    } catch (error) {
      // One failed/blocked/timed-out publisher site must never stop the
      // rest of the run.
      errors++;
      console.warn(`  [${index + 1}/${candidates.length}] ✗ ${project.title.slice(0, 60)} - ${error.message}`);
    }

    if (index < candidates.length - 1) {
      await delayMs(REQUEST_DELAY_MS);
    }
  }

  await fs.writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`);

  console.log("\n" + "=".repeat(60));
  console.log("Publication Image Fetch Summary");
  console.log("=".repeat(60));
  console.log(`Attempted:        ${candidates.length}`);
  console.log(`Image found:      ${found}`);
  console.log(`No image found:   ${notFound}`);
  console.log(`Errors:           ${errors}`);
  console.log(`Written to:       ${path.relative(rootDir, datasetPath)}`);
  console.log("=".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("Fatal error during publication image fetch:", error);
  process.exitCode = 1;
});
