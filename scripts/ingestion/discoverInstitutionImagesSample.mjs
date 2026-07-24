import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { evaluateImageRelevance } from "../processing/mockImageRelevanceEvaluator.mjs";
import { delayMs } from "./http.mjs";

// FEASIBILITY TEST ONLY - a small, explicit sample, not a global crawl.
//
// Visits each sample institution's own official homepage (never a search
// engine, never Google Images), extracts real candidate images the page
// itself declares as representative (og:image, twitter:image, schema.org
// logo/image, favicon as a low-confidence fallback, and inline <img> tags
// whose src/alt suggest an official asset), scores each candidate with the
// MOCK evaluator (scripts/processing/mockImageRelevanceEvaluator.mjs -
// deterministic rules, no AI, no network call of its own), and only
// downloads images that score as "accept". Nothing is ever invented: every
// accepted image keeps its real source page URL, and every rejected
// candidate keeps its reason.
//
// Known official domains are hardcoded here deliberately - the current
// dataset (src/data/generated/liveResearchData.json) has a real `website`
// field on only 1 of 381 institutions, so there is nothing to read this
// list FROM yet. This is an explicit, reviewable seed list for the sample,
// not a discovery mechanism in itself (that's the "future AI API" swap
// point - see docs/IMAGE_FETCHING_AND_AI_EVALUATION.md).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const testInstitutionsDir = path.join(rootDir, "public/assets/test/institutions");
const outputPath = path.join(rootDir, "data/processed/test/institution-image-sample.json");

export const SAMPLE_INSTITUTIONS = [
  { name: "Nanyang Technological University", country: "Singapore", officialDomain: "ntu.edu.sg", homepageUrl: "https://www.ntu.edu.sg/" },
  { name: "SRM Institute of Science and Technology", country: "India", officialDomain: "srmist.edu.in", homepageUrl: "https://www.srmist.edu.in/" },
  { name: "Maritime and Port Authority of Singapore", country: "Singapore", officialDomain: "mpa.gov.sg", homepageUrl: "https://www.mpa.gov.sg/" },
  { name: "National University of Singapore", country: "Singapore", officialDomain: "nus.edu.sg", homepageUrl: "https://www.nus.edu.sg/" },
  { name: "VERKIS HF", country: "Iceland", officialDomain: "verkis.is", homepageUrl: "https://www.verkis.is/" },
  { name: "SINTEF Ocean", country: "Norway", officialDomain: "sintef.no", homepageUrl: "https://www.sintef.no/en/sintef-ocean/" },
  { name: "Norwegian University of Science and Technology", country: "Norway", officialDomain: "ntnu.edu", homepageUrl: "https://www.ntnu.edu/" },
  { name: "University of Oslo", country: "Norway", officialDomain: "uio.no", homepageUrl: "https://www.uio.no/english/" },
  { name: "Technical University of Denmark", country: "Denmark", officialDomain: "dtu.dk", homepageUrl: "https://www.dtu.dk/english" },
  { name: "Delft University of Technology", country: "Netherlands", officialDomain: "tudelft.nl", homepageUrl: "https://www.tudelft.nl/en/" },
];

// --- Safety limits (Part G) ---
const MAX_INSTITUTIONS = 20;
const MAX_IMAGES_PER_INSTITUTION = 10;
const MAX_ACCEPTED_PER_INSTITUTION = 1;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB
const REQUEST_TIMEOUT_MS = 15000;
// A real pixel-dimension check would need an image-decoding library, which
// this project does not have installed; content-length is used as a
// documented stand-in (see docs/IMAGE_FETCHING_AND_AI_EVALUATION.md's
// limitations note) - anything under this many bytes reads as an icon/
// tracking pixel, not a usable photo/logo.
const MIN_IMAGE_BYTES = 1024;

const USER_AGENT = "GlobalMaritimeResearchIntelligenceMap/0.3 (institution-image-feasibility-test)";

const CONTENT_TYPE_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

function nowIso() {
  return new Date().toISOString();
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

async function fileExistsWithAnyExtension(baseDir) {
  try {
    const files = await fs.readdir(baseDir);
    return files.find((f) => /^image\.\w+$/.test(f)) ?? null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function fetchHomepage(url) {
  try {
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html/i.test(contentType)) {
      return { ok: false, error: `Unexpected content-type: ${contentType}` };
    }
    const html = await response.text();
    return { ok: true, html };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function toAbsoluteUrl(raw, baseUrl) {
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

// Only these path/alt keywords count as an "official asset" signal for a
// plain inline <img> - anything else inline is too likely to be unrelated
// editorial/decorative content on a large university homepage.
const OFFICIAL_IMG_KEYWORD_PATTERN = /logo|campus|building|about|media|brand/i;

function extractCandidates(html, pageUrl) {
  const $ = cheerio.load(html);
  const pageTitle = $("meta[property='og:title']").attr("content") || $("title").first().text().trim() || "";

  const candidates = [];
  const seenUrls = new Set();
  const push = (url, fetchMethod, alt = "", title = "") => {
    const absolute = toAbsoluteUrl(url, pageUrl);
    if (!absolute || seenUrls.has(absolute)) return;
    seenUrls.add(absolute);
    candidates.push({ url: absolute, fetchMethod, alt, title });
  };

  push($("meta[property='og:image:secure_url']").attr("content") || $("meta[property='og:image']").attr("content"), "og:image");
  push($("meta[name='twitter:image']").attr("content") || $("meta[name='twitter:image:src']").attr("content"), "twitter:image");

  $("script[type='application/ld+json']").each((_, el) => {
    let json;
    try {
      json = JSON.parse($(el).text());
    } catch {
      return;
    }
    const items = Array.isArray(json) ? json : [json];
    items.forEach((item) => {
      if (!item || typeof item !== "object") return;
      if (item.logo) {
        push(typeof item.logo === "string" ? item.logo : item.logo.url, "schema:logo");
      }
      if (item.image) {
        const imageValue = Array.isArray(item.image) ? item.image[0] : item.image;
        push(typeof imageValue === "string" ? imageValue : imageValue?.url, "schema:image");
      }
    });
  });

  const iconHref = $("link[rel='icon']").attr("href") || $("link[rel='shortcut icon']").attr("href");
  push(iconHref, "link:icon");

  $("img[src]").each((_, el) => {
    if (candidates.length >= MAX_IMAGES_PER_INSTITUTION) return;
    const src = $(el).attr("src");
    const alt = $(el).attr("alt")?.trim() ?? "";
    const title = $(el).attr("title")?.trim() ?? "";
    if (OFFICIAL_IMG_KEYWORD_PATTERN.test(`${src} ${alt}`)) {
      push(src, "page:img", alt, title);
    }
  });

  return { pageTitle, candidates: candidates.slice(0, MAX_IMAGES_PER_INSTITUTION) };
}

async function downloadImage(url, destDirBase) {
  try {
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      return { status: "error", error: `HTTP ${response.status} ${response.statusText}` };
    }
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!contentType.startsWith("image/")) {
      return { status: "error", error: `Content-type is not image/*: ${contentType || "(none)"}` };
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength && contentLength > MAX_IMAGE_BYTES) {
      return { status: "error", error: `Image too large (${contentLength} bytes > ${MAX_IMAGE_BYTES})` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) {
      return { status: "error", error: `Image too large (${buffer.length} bytes > ${MAX_IMAGE_BYTES})` };
    }
    if (buffer.length < MIN_IMAGE_BYTES) {
      return { status: "error", error: `Image too small (${buffer.length} bytes) - likely an icon or tracking pixel` };
    }
    const ext = CONTENT_TYPE_EXTENSIONS[contentType] ?? path.extname(new URL(url).pathname) ?? ".jpg";
    const destDir = path.dirname(destDirBase);
    await fs.mkdir(destDir, { recursive: true });
    const destPath = `${destDirBase}${ext}`;
    await fs.writeFile(destPath, buffer);
    return { status: "ok", bytes: buffer.length, ext, destPath };
  } catch (error) {
    return { status: "error", error: error.message };
  }
}

async function processInstitution(institution, { force, dryRun, log }) {
  const slug = slugify(institution.name);
  const accepted = [];
  const rejected = [];

  const page = await fetchHomepage(institution.homepageUrl);
  if (!page.ok) {
    rejected.push({
      institutionName: institution.name,
      country: institution.country,
      institutionSlug: slug,
      officialDomain: institution.officialDomain,
      candidateImageUrl: null,
      imageSourceUrl: institution.homepageUrl,
      accepted: false,
      mockAiDecision: "reject",
      rejectionReason: `page-fetch-failed: ${page.error}`,
      fetchedAt: nowIso(),
    });
    return { accepted, rejected };
  }

  const { pageTitle, candidates } = extractCandidates(page.html, institution.homepageUrl);

  const existingImageFile = await fileExistsWithAnyExtension(path.join(testInstitutionsDir, slug));
  if (existingImageFile && !force) {
    accepted.push({
      institutionName: institution.name,
      country: institution.country,
      institutionSlug: slug,
      officialDomain: institution.officialDomain,
      candidateImageUrl: null,
      downloadedPath: `/assets/test/institutions/${slug}/${existingImageFile}`,
      imageSourceUrl: institution.homepageUrl,
      imageSourceName: pageTitle || institution.name,
      rightsNote: "Rights not verified; feasibility-test download only - do not use in production without confirming reuse rights.",
      confidence: "n/a",
      accepted: true,
      mockAiScore: null,
      mockAiDecision: "accept",
      mockAiReason: "Preserved existing downloaded image (skipped re-fetch; pass --force to refresh).",
      fetchMethod: "existing",
      rejectionReason: null,
      fetchedAt: nowIso(),
    });
    return { accepted, rejected };
  }

  let acceptedCount = 0;
  for (const candidate of candidates) {
    if (acceptedCount >= MAX_ACCEPTED_PER_INSTITUTION) break;

    const verdict = evaluateImageRelevance({
      targetType: "institution",
      targetName: institution.name,
      country: institution.country,
      candidateImageUrl: candidate.url,
      imageSourceUrl: institution.homepageUrl,
      imageAlt: candidate.alt,
      imageTitle: candidate.title,
      pageTitle,
      sourceDomain: institution.officialDomain,
      fetchMethod: candidate.fetchMethod,
    });

    if (verdict.decision !== "accept") {
      rejected.push({
        institutionName: institution.name,
        country: institution.country,
        institutionSlug: slug,
        officialDomain: institution.officialDomain,
        candidateImageUrl: candidate.url,
        imageSourceUrl: institution.homepageUrl,
        accepted: false,
        mockAiScore: verdict.score,
        mockAiDecision: verdict.decision,
        mockAiReason: verdict.reasons.join("; ") || verdict.risks.join("; "),
        fetchMethod: candidate.fetchMethod,
        rejectionReason: verdict.decision === "review" ? "needs-human-review" : verdict.reasons[0] || "low-confidence",
        fetchedAt: nowIso(),
      });
      continue;
    }

    if (dryRun) {
      accepted.push({
        institutionName: institution.name,
        country: institution.country,
        institutionSlug: slug,
        officialDomain: institution.officialDomain,
        candidateImageUrl: candidate.url,
        downloadedPath: null,
        imageSourceUrl: institution.homepageUrl,
        imageSourceName: pageTitle || institution.name,
        rightsNote: "Rights not verified; feasibility-test only - not downloaded (dry run).",
        confidence: verdict.score >= 0.85 ? "high" : "medium",
        accepted: true,
        mockAiScore: verdict.score,
        mockAiDecision: verdict.decision,
        mockAiReason: verdict.reasons.join("; "),
        fetchMethod: candidate.fetchMethod,
        rejectionReason: null,
        fetchedAt: nowIso(),
        dryRun: true,
      });
      acceptedCount++;
      continue;
    }

    const destBase = path.join(testInstitutionsDir, slug, "image");
    const download = await downloadImage(candidate.url, destBase);
    if (download.status === "ok") {
      log(`  accepted + downloaded: ${institution.name} <- ${candidate.url} (${download.bytes} bytes)`);
      accepted.push({
        institutionName: institution.name,
        country: institution.country,
        institutionSlug: slug,
        officialDomain: institution.officialDomain,
        candidateImageUrl: candidate.url,
        downloadedPath: `/assets/test/institutions/${slug}/image${download.ext}`,
        imageSourceUrl: institution.homepageUrl,
        imageSourceName: pageTitle || institution.name,
        rightsNote: "Rights not verified; feasibility-test download only - do not use in production without confirming reuse rights.",
        confidence: verdict.score >= 0.85 ? "high" : "medium",
        accepted: true,
        mockAiScore: verdict.score,
        mockAiDecision: verdict.decision,
        mockAiReason: verdict.reasons.join("; "),
        fetchMethod: candidate.fetchMethod,
        rejectionReason: null,
        fetchedAt: nowIso(),
      });
      acceptedCount++;
    } else {
      log(`  download failed for ${institution.name} <- ${candidate.url}: ${download.error}`);
      rejected.push({
        institutionName: institution.name,
        country: institution.country,
        institutionSlug: slug,
        officialDomain: institution.officialDomain,
        candidateImageUrl: candidate.url,
        imageSourceUrl: institution.homepageUrl,
        accepted: false,
        mockAiScore: verdict.score,
        mockAiDecision: verdict.decision,
        mockAiReason: verdict.reasons.join("; "),
        fetchMethod: candidate.fetchMethod,
        rejectionReason: `download-failed: ${download.error}`,
        fetchedAt: nowIso(),
      });
    }
  }

  return { accepted, rejected };
}

export async function discoverInstitutionImagesSample({ limit = MAX_INSTITUTIONS, institutionFilter, force = false, dryRun = false, log = console.log } = {}) {
  const cappedLimit = Math.min(limit, MAX_INSTITUTIONS);
  const targets = SAMPLE_INSTITUTIONS.filter(
    (institution) => !institutionFilter || institution.name.toLowerCase().includes(institutionFilter.toLowerCase())
  ).slice(0, cappedLimit);

  const accepted = [];
  const rejected = [];

  for (const [index, institution] of targets.entries()) {
    log(`[${index + 1}/${targets.length}] ${institution.name} (${institution.officialDomain})`);
    const result = await processInstitution(institution, { force, dryRun, log });
    accepted.push(...result.accepted);
    rejected.push(...result.rejected);
    if (index < targets.length - 1) {
      await delayMs(500);
    }
  }

  const report = {
    generatedAt: nowIso(),
    command: "discover:institution-images:sample",
    isTestOutput: true,
    dryRun,
    limit: cappedLimit,
    institutionsAttempted: targets.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    accepted,
    rejected,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);

  return report;
}

function parseArgs(argv) {
  const args = { limit: MAX_INSTITUTIONS, force: false, dryRun: false, institution: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") args.force = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--institution") args.institution = argv[++i];
    else if (arg.startsWith("--institution=")) args.institution = arg.slice("--institution=".length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await discoverInstitutionImagesSample({
    limit: args.limit,
    institutionFilter: args.institution,
    force: args.force,
    dryRun: args.dryRun,
  });

  console.log("\n" + "=".repeat(60));
  console.log("Institution Image Discovery Sample Summary");
  console.log("=".repeat(60));
  console.log(`Mode:                  ${result.dryRun ? "DRY RUN (no downloads)" : "live"}`);
  console.log(`Institutions attempted: ${result.institutionsAttempted}`);
  console.log(`Accepted:              ${result.acceptedCount}`);
  console.log(`Rejected:              ${result.rejectedCount}`);
  console.log(`Report written to:    ${path.relative(rootDir, outputPath)}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during discover:institution-images:sample:", error);
    process.exitCode = 1;
  });
}
