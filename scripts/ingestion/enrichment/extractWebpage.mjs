// Step 3 of the AI Evidence Selection pipeline (see CLAUDE.md goal tracker
// item 9): fetch an original source webpage with plain code (no AI) and
// pull out structured, cleaned content. This is the "visit the original
// website" step — OpenAlex only ever gave us a URL to this page, not its
// content.
//
// The full HTML/text is never persisted past this in-memory step; only the
// short chunks built from it (chunkText.mjs) get written to disk, per the
// copyright/source-safety rule against storing full articles.

import * as cheerio from "cheerio";
import { fetchText } from "../http.mjs";
import { hashContent } from "../normalization.mjs";

const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "[role='navigation']",
  "[aria-hidden='true']",
];

const MAX_PARAGRAPHS = 60;
const MAX_LINKS = 40;
const MAX_IMAGES = 15;
const MIN_PARAGRAPH_LENGTH = 40;

function toAbsoluteUrl(raw, baseUrl) {
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return null;
  }
}

// fetchText() decodes any response body as UTF-8 text, including PDFs and
// other binary files (many DOI/publisher links resolve straight to a PDF).
// Parsing that as HTML produces garbage "chunks" of control characters, so
// reject non-HTML content here rather than storing it as evidence.
function assertLooksLikeHtml(text, url) {
  const head = text.slice(0, 2048);
  if (head.startsWith("%PDF-")) {
    throw new Error(`Response is a PDF, not HTML (no PDF text extraction yet): ${url}`);
  }
  if (!/<html|<!doctype html/i.test(head)) {
    throw new Error(`Response does not look like HTML: ${url}`);
  }
}

function extractPublishedDate($) {
  const metaCandidates = [
    "meta[property='article:published_time']",
    "meta[name='date']",
    "meta[name='publish-date']",
    "meta[name='dc.date']",
  ];

  for (const selector of metaCandidates) {
    const value = $(selector).attr("content");
    if (value) return value;
  }

  const timeEl = $("time[datetime]").first();
  return timeEl.attr("datetime") ?? null;
}

/**
 * Fetches and parses one webpage. Returns null (rather than throwing) on
 * fetch/parse failure so one bad source page never stops the pipeline —
 * the caller is expected to log and continue.
 */
export async function extractWebpage(url, { requestDelayMs = 2000 } = {}) {
  const html = await fetchText(url, {
    fetchOptions: {
      email: "research-demo@example.invalid",
      retries: 3,
      timeout: 20000,
      requestDelay: requestDelayMs,
    },
  });

  assertLooksLikeHtml(html, url);

  const $ = cheerio.load(html);
  $(NOISE_SELECTORS.join(",")).remove();

  const pageTitle =
    $("meta[property='og:title']").attr("content") ||
    $("title").first().text().trim() ||
    null;

  const publishedDate = extractPublishedDate($);

  // Walk headings and paragraphs together, in document order, so each
  // paragraph can carry the heading it actually falls under (cheerio
  // preserves source order for a combined selector).
  const headings = [];
  const sections = [];
  let currentHeading = "";

  $("h1, h2, h3, p").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text) return;

    if (el.tagName === "h1" || el.tagName === "h2" || el.tagName === "h3") {
      currentHeading = text;
      if (!headings.includes(text)) headings.push(text);
      return;
    }

    if (sections.length < MAX_PARAGRAPHS && text.length >= MIN_PARAGRAPH_LENGTH) {
      sections.push({ heading: currentHeading, text });
    }
  });

  const links = [];
  const seenLinks = new Set();
  $("a[href]").each((_, el) => {
    if (links.length >= MAX_LINKS) return;
    const absolute = toAbsoluteUrl($(el).attr("href"), url);
    if (absolute && !seenLinks.has(absolute)) {
      seenLinks.add(absolute);
      links.push(absolute);
    }
  });

  const images = [];
  const seenImages = new Set();
  $("img[src]").each((_, el) => {
    if (images.length >= MAX_IMAGES) return;
    const absolute = toAbsoluteUrl($(el).attr("src"), url);
    if (!absolute || seenImages.has(absolute)) return;
    seenImages.add(absolute);
    images.push({
      imageUrl: absolute,
      altText: $(el).attr("alt")?.trim() ?? "",
      caption: $(el).closest("figure").find("figcaption").text().trim() ?? "",
      sourceUrl: url,
      canEmbed: false,
      rightsNote: "Rights not verified; not embedded automatically.",
    });
  });

  return {
    sourceUrl: url,
    pageTitle,
    publishedDate,
    headings,
    sections,
    links,
    images,
    contentHash: hashContent(html),
  };
}
