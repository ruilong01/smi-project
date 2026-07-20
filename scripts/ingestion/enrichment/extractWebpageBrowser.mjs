// Playwright fallback for pages that need JS execution to render real
// content (many publisher DOI-resolver redirects and abstract pages are
// client-side rendered — a plain fetch() gets an empty shell). Used only
// when extractWebpage() (plain HTTP GET) returns zero content, per
// CLAUDE.md's "Playwright only when required" rule — never as the default
// fetch path, since it's far heavier (real browser process per page).
//
// Reuses parseHtml() from extractWebpage.mjs so both fetch paths produce
// the identical structured shape — no duplicated extraction logic.

import { chromium } from "playwright";
import { parseHtml } from "./extractWebpage.mjs";

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({ headless: true });
  }
  return browserPromise;
}

export async function extractWebpageWithBrowser(url, { timeoutMs = 20000 } = {}) {
  const browser = await getBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/120.0.0.0 Safari/537.36 GlobalMaritimeResearchIntelligenceMap/0.2 (research-demo@example.invalid)",
  });
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Give client-side rendering (React/Vue publisher sites) a moment to
    // paint the abstract/body content after the initial DOM load.
    await page.waitForTimeout(2000);
    const html = await page.content();
    const finalUrl = page.url();
    return parseHtml(html, finalUrl);
  } finally {
    await context.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}
