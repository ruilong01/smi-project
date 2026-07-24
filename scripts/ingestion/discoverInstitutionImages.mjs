import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import institutionRegistryData from "../../src/data/generated/institutionRegistry.json" with { type: "json" };
import { evaluateImageRelevance } from "../processing/mockImageRelevanceEvaluator.mjs";
import { delayMs } from "./http.mjs";

// Step 4 of the global data/image expansion plan (see
// docs/GLOBAL_DATA_AND_IMAGE_EXPANSION_PLAN.md): the general, registry-
// driven successor to discoverInstitutionImagesSample.mjs (kept - still a
// valid smaller/older entry point). Reads institutions from
// src/data/generated/institutionRegistry.json instead of a fixed sample
// list, tries a small, bounded set of official pages per institution (the
// homepage plus a few common guessed sub-paths: about/campus/media), and
// - the key upgrade over the sample script - collects EVERY candidate
// across all fetched pages before picking a winner, so a real landmark/
// campus photo found on an "about" page is preferred over a logo found on
// the homepage, never just whichever page happened to be tried first.
//
// KNOWN_OFFICIAL_DOMAINS is an explicit, reviewable seed list (same
// reasoning as discoverInstitutionImagesSample.mjs: the registry's
// officialWebsite field is populated for only 1 of 381 institutions
// today, so there is nothing to discover a homepage FROM yet without a
// real search API, which does not exist in this app). An institution with
// neither a registry website nor a known-domain override is marked
// not-searched with an explicit reason - never given a guessed URL.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const institutionsAssetDir = path.join(rootDir, "public/assets/institutions");
const outputPath = path.join(rootDir, "data/processed/test/institution-image-discovery.json");

export const KNOWN_OFFICIAL_DOMAINS = {
  "nanyang technological university": "https://www.ntu.edu.sg/",
  "srm institute of science and technology": "https://www.srmist.edu.in/",
  "maritime and port authority of singapore": "https://www.mpa.gov.sg/",
  "national university of singapore": "https://www.nus.edu.sg/",
  "verkis hf": "https://www.verkis.is/",
  "sintef ocean": "https://www.sintef.no/en/sintef-ocean/",
  "norwegian university of science and technology": "https://www.ntnu.edu/",
  "university of oslo": "https://www.uio.no/english/",
  "technical university of denmark": "https://www.dtu.dk/english",
  "delft university of technology": "https://www.tudelft.nl/en/",
};

const GUESSED_SUBPATHS = ["about", "about-us", "campus", "media"];

// --- Safety limits (Part G-equivalent for this step) ---
const MAX_INSTITUTIONS = 20;
const MAX_CANDIDATE_PAGES = 5;
const MAX_IMAGES_PER_INSTITUTION_PAGE = 20;
const MAX_ACCEPTED_PER_INSTITUTION = 1;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB
const REQUEST_TIMEOUT_MS = 15000;
const MIN_IMAGE_BYTES = 1024;

const USER_AGENT = "GlobalMaritimeResearchIntelligenceMap/0.3 (institution-image-discovery)";

const CONTENT_TYPE_EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
};

// Highest-priority image type wins when picking the one accepted image for
// an institution, even if a lower-priority type happened to score higher.
const IMAGE_TYPE_PRIORITY = ["landmark-building", "campus", "hero", "wikimedia", "logo", "fallback"];

function nowIso() {
  return new Date().toISOString();
}

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
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
    const response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": USER_AGENT } });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

async function fetchPage(url) {
  try {
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    if (!response.ok) return { ok: false, error: `HTTP ${response.status} ${response.statusText}` };
    const contentType = response.headers.get("content-type") ?? "";
    if (!/html/i.test(contentType)) return { ok: false, error: `Unexpected content-type: ${contentType}` };
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

const OFFICIAL_IMG_KEYWORD_PATTERN = /logo|campus|building|about|media|brand|landmark|hero/i;

function extractCandidatesFromPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const pageTitle = $("meta[property='og:title']").attr("content") || $("title").first().text().trim() || "";

  const candidates = [];
  const seenUrls = new Set();
  const push = (url, fetchMethod, alt = "", title = "") => {
    const absolute = toAbsoluteUrl(url, pageUrl);
    if (!absolute || seenUrls.has(absolute)) return;
    seenUrls.add(absolute);
    candidates.push({ url: absolute, fetchMethod, alt, title, pageUrl, pageTitle });
  };

  // Inline <img> tags with a relevant keyword go first in extraction order
  // (Image extraction priority #1) - og:image/schema/icon still get
  // collected too, since the FULL candidate set across all pages is
  // scored and the best one picked, not just the first found.
  $("img[src]").each((_, el) => {
    if (candidates.length >= MAX_IMAGES_PER_INSTITUTION_PAGE) return;
    const src = $(el).attr("src");
    const alt = $(el).attr("alt")?.trim() ?? "";
    const title = $(el).attr("title")?.trim() ?? "";
    if (OFFICIAL_IMG_KEYWORD_PATTERN.test(`${src} ${alt}`)) {
      push(src, "page:img", alt, title);
    }
  });

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
      if (item.logo) push(typeof item.logo === "string" ? item.logo : item.logo.url, "schema:logo");
      if (item.image) {
        const imageValue = Array.isArray(item.image) ? item.image[0] : item.image;
        push(typeof imageValue === "string" ? imageValue : imageValue?.url, "schema:image");
      }
    });
  });

  const iconHref = $("link[rel='icon']").attr("href") || $("link[rel='shortcut icon']").attr("href");
  push(iconHref, "link:icon");

  return candidates.slice(0, MAX_IMAGES_PER_INSTITUTION_PAGE);
}

async function downloadImage(url, destDirBase) {
  try {
    const response = await fetchWithTimeout(url, REQUEST_TIMEOUT_MS);
    if (!response.ok) return { status: "error", error: `HTTP ${response.status} ${response.statusText}` };
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!contentType.startsWith("image/")) return { status: "error", error: `Content-type is not image/*: ${contentType || "(none)"}` };
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength && contentLength > MAX_IMAGE_BYTES) return { status: "error", error: `Image too large (${contentLength} bytes)` };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) return { status: "error", error: `Image too large (${buffer.length} bytes)` };
    if (buffer.length < MIN_IMAGE_BYTES) return { status: "error", error: `Image too small (${buffer.length} bytes) - likely an icon/tracking pixel` };
    const ext = CONTENT_TYPE_EXTENSIONS[contentType] ?? path.extname(new URL(url).pathname) ?? ".jpg";
    await fs.mkdir(path.dirname(destDirBase), { recursive: true });
    const destPath = `${destDirBase}${ext}`;
    await fs.writeFile(destPath, buffer);
    return { status: "ok", bytes: buffer.length, ext };
  } catch (error) {
    return { status: "error", error: error.message };
  }
}

function candidatePageUrls(homepageUrl) {
  const urls = [homepageUrl];
  for (const sub of GUESSED_SUBPATHS) {
    if (urls.length >= MAX_CANDIDATE_PAGES) break;
    urls.push(toAbsoluteUrl(`/${sub}`, homepageUrl));
  }
  return urls.slice(0, MAX_CANDIDATE_PAGES);
}

async function processInstitution(entry, { force, dryRun, log }) {
  const homepageUrl = entry.officialWebsite || KNOWN_OFFICIAL_DOMAINS[entry.normalizedName];
  const officialDomain = homepageUrl ? new URL(homepageUrl).hostname.replace(/^www\./, "") : entry.officialDomain;

  if (!homepageUrl) {
    return {
      accepted: [],
      rejected: [
        {
          institutionName: entry.institutionName,
          country: entry.country,
          institutionSlug: entry.slug,
          candidateImageUrl: null,
          imageSourceUrl: null,
          accepted: false,
          mockAiDecision: "reject",
          rejectionReason: "no-known-official-domain: no registry website and no known-domain override - cannot safely search without inventing a URL.",
          fetchedAt: nowIso(),
        },
      ],
    };
  }

  const existingImageFile = await fileExistsWithAnyExtension(path.join(institutionsAssetDir, entry.slug));
  if (existingImageFile && !force) {
    return {
      accepted: [
        {
          institutionName: entry.institutionName,
          country: entry.country,
          institutionSlug: entry.slug,
          officialDomain,
          candidateImageUrl: null,
          downloadedPath: `/assets/institutions/${entry.slug}/${existingImageFile}`,
          imageSourceUrl: homepageUrl,
          imageSourceName: entry.institutionName,
          rightsNote: "Source-proven official website image; verify usage rights before commercial redistribution.",
          imageType: entry.imageType ?? "logo",
          confidence: entry.confidence ?? "n/a",
          accepted: true,
          mockAiScore: null,
          mockAiDecision: "accept",
          mockAiReason: "Preserved existing accepted image (pass --force to re-discover).",
          rejectionReason: null,
          fetchedAt: nowIso(),
        },
      ],
      rejected: [],
    };
  }

  const pages = candidatePageUrls(homepageUrl);
  const allCandidates = [];
  for (const pageUrl of pages) {
    const page = await fetchPage(pageUrl);
    if (!page.ok) {
      log(`    page fetch failed (${pageUrl}): ${page.error}`);
      continue;
    }
    allCandidates.push(...extractCandidatesFromPage(page.html, pageUrl));
    await delayMs(300);
  }

  if (allCandidates.length === 0) {
    return {
      accepted: [],
      rejected: [
        {
          institutionName: entry.institutionName,
          country: entry.country,
          institutionSlug: entry.slug,
          officialDomain,
          candidateImageUrl: null,
          imageSourceUrl: homepageUrl,
          accepted: false,
          mockAiDecision: "reject",
          rejectionReason: "no-candidates-found: none of the fetched official pages yielded an extractable image.",
          fetchedAt: nowIso(),
        },
      ],
    };
  }

  const evaluated = allCandidates.map((candidate) => ({
    candidate,
    verdict: evaluateImageRelevance({
      targetType: "institution",
      targetName: entry.institutionName,
      country: entry.country,
      candidateImageUrl: candidate.url,
      imageSourceUrl: candidate.pageUrl,
      imageAlt: candidate.alt,
      imageTitle: candidate.title,
      pageTitle: candidate.pageTitle,
      sourceDomain: officialDomain,
      fetchMethod: candidate.fetchMethod,
    }),
  }));

  const rejected = [];
  const acceptedCandidates = evaluated.filter(({ verdict }) => verdict.decision === "accept");
  evaluated
    .filter(({ verdict }) => verdict.decision !== "accept")
    .forEach(({ candidate, verdict }) => {
      rejected.push({
        institutionName: entry.institutionName,
        country: entry.country,
        institutionSlug: entry.slug,
        officialDomain,
        candidateImageUrl: candidate.url,
        imageSourceUrl: candidate.pageUrl,
        accepted: false,
        mockAiScore: verdict.score,
        mockAiDecision: verdict.decision,
        mockAiReason: verdict.reasons.join("; ") || verdict.risks.join("; "),
        imageType: verdict.imageType,
        fetchMethod: candidate.fetchMethod,
        rejectionReason: verdict.decision === "review" ? "needs-human-review" : verdict.reasons[0] || "low-confidence",
        fetchedAt: nowIso(),
      });
    });

  if (acceptedCandidates.length === 0) {
    return { accepted: [], rejected };
  }

  // Best image wins: highest-priority TYPE first (landmark > campus > hero
  // > wikimedia > logo > fallback), then highest score within that type -
  // this is the actual landmark-over-logo preference, applied across every
  // page fetched for this institution, not just whichever loaded first.
  acceptedCandidates.sort((a, b) => {
    const typeDiff = IMAGE_TYPE_PRIORITY.indexOf(a.verdict.imageType) - IMAGE_TYPE_PRIORITY.indexOf(b.verdict.imageType);
    if (typeDiff !== 0) return typeDiff;
    return b.verdict.score - a.verdict.score;
  });

  const accepted = [];
  for (const { candidate, verdict } of acceptedCandidates.slice(0, MAX_ACCEPTED_PER_INSTITUTION)) {
    if (dryRun) {
      accepted.push({
        institutionName: entry.institutionName,
        country: entry.country,
        institutionSlug: entry.slug,
        officialDomain,
        candidateImageUrl: candidate.url,
        downloadedPath: null,
        imageSourceUrl: candidate.pageUrl,
        imageSourceName: candidate.pageTitle || entry.institutionName,
        rightsNote: "Rights not verified; dry run only - not downloaded.",
        imageType: verdict.imageType,
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
      continue;
    }

    const destBase = path.join(institutionsAssetDir, entry.slug, "image");
    const download = await downloadImage(candidate.url, destBase);
    if (download.status === "ok") {
      log(`  accepted (${verdict.imageType}) + downloaded: ${entry.institutionName} <- ${candidate.url}`);
      accepted.push({
        institutionName: entry.institutionName,
        country: entry.country,
        institutionSlug: entry.slug,
        officialDomain,
        candidateImageUrl: candidate.url,
        downloadedPath: `/assets/institutions/${entry.slug}/image${download.ext}`,
        imageSourceUrl: candidate.pageUrl,
        imageSourceName: candidate.pageTitle || entry.institutionName,
        rightsNote: "Source-proven official website image; verify usage rights before commercial redistribution.",
        imageType: verdict.imageType,
        confidence: verdict.score >= 0.85 ? "high" : "medium",
        accepted: true,
        mockAiScore: verdict.score,
        mockAiDecision: verdict.decision,
        mockAiReason: verdict.reasons.join("; "),
        fetchMethod: candidate.fetchMethod,
        rejectionReason: null,
        fetchedAt: nowIso(),
      });
    } else {
      log(`  download failed for ${entry.institutionName} <- ${candidate.url}: ${download.error}`);
      rejected.push({
        institutionName: entry.institutionName,
        country: entry.country,
        institutionSlug: entry.slug,
        officialDomain,
        candidateImageUrl: candidate.url,
        imageSourceUrl: candidate.pageUrl,
        accepted: false,
        mockAiScore: verdict.score,
        mockAiDecision: verdict.decision,
        imageType: verdict.imageType,
        fetchMethod: candidate.fetchMethod,
        rejectionReason: `download-failed: ${download.error}`,
        fetchedAt: nowIso(),
      });
    }
  }

  return { accepted, rejected };
}

export async function discoverInstitutionImages({
  limit = MAX_INSTITUTIONS,
  countryFilter,
  institutionFilter,
  missingOnly = false,
  force = false,
  dryRun = false,
  log = console.log,
} = {}) {
  let candidates = institutionRegistryData.institutions ?? [];
  if (countryFilter) {
    candidates = candidates.filter((e) => (e.country || "").toLowerCase() === countryFilter.toLowerCase());
  }
  if (institutionFilter) {
    candidates = candidates.filter((e) => e.institutionName.toLowerCase().includes(institutionFilter.toLowerCase()));
  }
  if (missingOnly) {
    candidates = candidates.filter((e) => e.imageStatus !== "ready");
  }
  candidates = candidates.slice(0, Math.min(limit, MAX_INSTITUTIONS));

  const accepted = [];
  const rejected = [];

  for (const [index, entry] of candidates.entries()) {
    log(`[${index + 1}/${candidates.length}] ${entry.institutionName}`);
    const result = await processInstitution(entry, { force, dryRun, log });
    accepted.push(...result.accepted);
    rejected.push(...result.rejected);
    if (index < candidates.length - 1) {
      await delayMs(400);
    }
  }

  const report = {
    generatedAt: nowIso(),
    command: "discover:institution-images",
    isTestOutput: true,
    dryRun,
    limit,
    institutionsAttempted: candidates.length,
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
  const args = { limit: MAX_INSTITUTIONS, force: false, dryRun: false, missingOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--force") args.force = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--missing-only") args.missingOnly = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--country") args.country = argv[++i];
    else if (arg.startsWith("--country=")) args.country = arg.slice("--country=".length);
    else if (arg === "--institution") args.institution = argv[++i];
    else if (arg.startsWith("--institution=")) args.institution = arg.slice("--institution=".length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await discoverInstitutionImages({
    limit: args.limit,
    countryFilter: args.country,
    institutionFilter: args.institution,
    missingOnly: args.missingOnly,
    force: args.force,
    dryRun: args.dryRun,
  });

  console.log("\n" + "=".repeat(60));
  console.log("Institution Image Discovery Summary");
  console.log("=".repeat(60));
  console.log(`Mode:                   ${result.dryRun ? "DRY RUN (no downloads)" : "live"}`);
  console.log(`Institutions attempted: ${result.institutionsAttempted}`);
  console.log(`Accepted:               ${result.acceptedCount}`);
  console.log(`Rejected:               ${result.rejectedCount}`);
  console.log(`Report written to:     ${path.relative(rootDir, outputPath)}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during discover:institution-images:", error);
    process.exitCode = 1;
  });
}
