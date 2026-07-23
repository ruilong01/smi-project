import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { fetchText, delayMs } from "./http.mjs";
import { OPENALEX_EMAIL } from "./config.mjs";

// Extracts real structured project fields (start/end date, EC signature
// date, funded-under programme, total cost, EU contribution, grant
// agreement ID, DOI) from each CORDIS media-seed record's own project page
// and patches them onto data/processed/research-records.json. These are
// exactly the fields CORDIS itself displays in its "Project Information"
// panel - nothing here is inferred or guessed, only parsed straight out of
// the page the record's own sourceUrl already points to.
//
// Selectors below were confirmed against a live CORDIS project page
// (https://cordis.europa.eu/project/id/101138620, GAMMA) rather than
// guessed, since CORDIS's own markup isn't documented anywhere public.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const recordsPath = path.join(rootDir, "data/processed/research-records.json");

const REQUEST_DELAY_MS = 1200;
const FETCH_TIMEOUT_MS = 10000;

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function parseCordisDate(text) {
  const match = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(text ?? "");
  if (!match) return null;
  const [, day, monthName, year] = match;
  const monthIndex = MONTH_NAMES.indexOf(monthName.toLowerCase());
  if (monthIndex === -1) return null;
  const mm = String(monthIndex + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${year}-${mm}-${dd}`;
}

// CORDIS renders amounts like "€ 16 753 996,26" - spaces as thousands
// separators, comma as the decimal point.
function parseEuroAmount(text) {
  const match = /€\s*([\d\s.,]+)/.exec(text ?? "");
  if (!match) return null;
  const cleaned = match[1].replace(/\s/g, "").replace(/\.(?=\d{3})/g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function extractCordisFields($) {
  const acronym = $(".c-project-info__acronym").first().text().trim() || null;
  const grantAgreementId = ($(".c-project-info__id").first().text().match(/\d{5,}/) ?? [])[0] ?? null;
  const doiHref = $('a.link--external[href*="doi.org"]').first().attr("href") ?? null;
  const ecSignatureDate = parseCordisDate($('[data-se="project__info-signature"]').first().text());
  const timelineCols = $(".c-project-info__timeline .col-6");
  const startDate = parseCordisDate($(timelineCols.get(0)).text());
  const endDate = parseCordisDate($(timelineCols.get(1)).text());
  const fundedUnder = $(".c-project-info__fund-list li")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const totalCostEur = parseEuroAmount($(".c-project-info__overall").first().text());
  const euContributionEur = parseEuroAmount($(".c-project-info__eu").first().text());

  return {
    acronym,
    grantAgreementId,
    doi: doiHref ? doiHref.replace(/^https?:\/\/doi\.org\//, "") : null,
    ecSignatureDate,
    startDate,
    endDate,
    fundedUnder,
    totalCostEur,
    euContributionEur,
  };
}

function landingUrlForRecord(record) {
  return record.sourceUrl || record.sourceUrls?.[0] || null;
}

async function main() {
  const raw = await fs.readFile(recordsPath, "utf8");
  const data = JSON.parse(raw);

  // Idempotent by default - skip records that already have startDate from a
  // previous run of this same script.
  const candidates = (data.records ?? []).filter((record) => {
    const url = landingUrlForRecord(record);
    return url && url.includes("cordis.europa.eu") && !record.startDate;
  });

  console.log(`[extract:cordis-details] ${candidates.length} CORDIS record(s) without extracted project details.`);

  let found = 0;
  let errors = 0;

  for (const [index, record] of candidates.entries()) {
    const url = landingUrlForRecord(record);
    try {
      const html = await fetchText(url, {
        fetchOptions: { email: OPENALEX_EMAIL, timeout: FETCH_TIMEOUT_MS, retries: 2, requestDelay: REQUEST_DELAY_MS },
      });
      const $ = cheerio.load(html);
      const details = extractCordisFields($);

      record.startDate = details.startDate;
      record.endDate = details.endDate;
      record.ecSignatureDate = details.ecSignatureDate;
      record.fundedUnder = details.fundedUnder;
      record.totalCostEur = details.totalCostEur;
      record.euContributionEur = details.euContributionEur;
      record.grantAgreementId = details.grantAgreementId;
      // Only fill doi in if this record didn't already have one - never
      // overwrite a real value with a re-parsed one.
      if (!record.doi && details.doi) {
        record.doi = details.doi;
      }

      found++;
      console.log(`  [${index + 1}/${candidates.length}] ✓ ${record.acronym || record.recordId}`);
    } catch (error) {
      errors++;
      console.warn(`  [${index + 1}/${candidates.length}] ✗ ${record.acronym || record.recordId} - ${error.message}`);
    }

    if (index < candidates.length - 1) {
      await delayMs(REQUEST_DELAY_MS);
    }
  }

  if (found > 0) {
    const backupPath = `${recordsPath}.bak`;
    await fs.copyFile(recordsPath, backupPath);
    await fs.writeFile(recordsPath, `${JSON.stringify(data, null, 2)}\n`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("CORDIS Project Details Extraction Summary");
  console.log("=".repeat(60));
  console.log(`Attempted:  ${candidates.length}`);
  console.log(`Extracted:  ${found}`);
  console.log(`Errors:     ${errors}`);
  console.log("=".repeat(60) + "\n");
}

main().catch((error) => {
  console.error("Fatal error during CORDIS project details extraction:", error);
  process.exitCode = 1;
});
