import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Static-check gate for the "image-ready records belong in the main
// country/institution/research-detail journey, not only in Research
// Gallery" rule (Foundation Step: user journey correction). This does not
// render the app - it greps the actual source files, the same technique
// verifyDisplayEligibility.mjs already uses for its frontend-wiring check
// - fast, no browser/build step required, and catches the exact regression
// this step exists to prevent (a user-facing page quietly going back to
// reading raw/legacy records as normal cards).
//
// Checks:
//  1. Country/institution detail pages don't import research-records.json
//     directly (the full, admin/debug-only file).
//  2. Institution/country pages route through the display-eligible-only
//     helpers (filterImageReadyProjects / getGalleryRecordsFor*), not the
//     raw project lists alone.
//  3. No shared research-card component renders the old blanket
//     "Image candidate not available yet" placeholder as a normal card
//     (the dead ResearchRecordRow.jsx must not have come back).
//  4. The research detail page (ResearchGalleryDetail.jsx) actually
//     references image/rights/provenance fields for displayEligible
//     records.
//  5. Card/explanation components hide empty fields (return null / are
//     conditionally rendered) rather than printing blank headings.
//  6. CountryFlagBadge has a non-emoji fallback path.
//  7. researchGalleryData.js (the seam every normal display path in 1-4
//     goes through) still reads display-records.json, not research-records.json.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const srcDir = path.join(rootDir, "src");

async function readIfExists(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

export async function verifyFrontendDisplayFlow() {
  const failures = [];
  const warnings = [];

  const files = {
    countryDetail: await readIfExists(path.join(srcDir, "pages/CountryDetail.jsx")),
    countryPanel: await readIfExists(path.join(srcDir, "components/CountryProfilePanel.jsx")),
    institutionDetail: await readIfExists(path.join(srcDir, "pages/InstitutionDetail.jsx")),
    galleryDetail: await readIfExists(path.join(srcDir, "pages/ResearchGalleryDetail.jsx")),
    researchRecordCard: await readIfExists(path.join(srcDir, "components/ResearchRecordCard.jsx")),
    countryFlagBadge: await readIfExists(path.join(srcDir, "components/CountryFlagBadge.jsx")),
    galleryData: await readIfExists(path.join(srcDir, "data/researchGalleryData.js")),
  };

  Object.entries(files).forEach(([key, content]) => {
    if (!content) failures.push(`Expected source file for check "${key}" was not found.`);
  });
  if (failures.length) {
    return { ok: false, failures, warnings };
  }

  // 1. No user-facing journey page imports the raw admin/debug file directly.
  ["countryDetail", "countryPanel", "institutionDetail"].forEach((key) => {
    if (/research-records\.json/.test(files[key])) {
      failures.push(`${key}: imports research-records.json directly - must go through researchProjectData.js/researchGalleryData.js's display-eligible-filtered helpers.`);
    }
  });

  // 2. These pages must route through the image-ready / gallery helpers,
  // not just the raw per-country/per-institution project lists.
  if (!/filterImageReadyProjects/.test(files.countryDetail) || !/getGalleryRecordsForCountryCode/.test(files.countryDetail)) {
    failures.push("CountryDetail.jsx: research-record cards must be built from filterImageReadyProjects(...) and getGalleryRecordsForCountryCode(...), not the raw country project list.");
  }
  if (!/filterImageReadyProjects/.test(files.countryPanel) || !/getGalleryRecordsForCountryCode/.test(files.countryPanel)) {
    failures.push("CountryProfilePanel.jsx: research-record cards must be built from filterImageReadyProjects(...) and getGalleryRecordsForCountryCode(...), not the raw country project list.");
  }
  if (!/filterImageReadyProjects/.test(files.institutionDetail) || !/getGalleryRecordsForInstitutionName/.test(files.institutionDetail)) {
    failures.push("InstitutionDetail.jsx: research-record cards must be built from filterImageReadyProjects(...) and getGalleryRecordsForInstitutionName(...), not the raw led/partnered project lists.");
  }

  // 3. The old blanket placeholder must not be reachable as a normal card
  // anywhere in the shared card component, and the dead component that
  // used to render it must stay gone.
  if (/Image candidate not available yet/.test(files.researchRecordCard)) {
    failures.push("ResearchRecordCard.jsx: must never render 'Image candidate not available yet' - it is only ever used for image-ready records; callers filter first.");
  }
  const oldRowPath = path.join(srcDir, "components/ResearchRecordRow.jsx");
  const oldRowExists = await fs
    .access(oldRowPath)
    .then(() => true)
    .catch(() => false);
  if (oldRowExists) {
    warnings.push("src/components/ResearchRecordRow.jsx exists again - confirm nothing reintroduced the old no-image-as-normal-card behaviour it used to render.");
  }

  // 4. Research detail page must reference image + rights + provenance
  // fields for every field Rule 2 lists.
  const requiredDetailFields = [
    "rightsNote",
    "sourceUrl",
    "verificationStatus",
    "summary",
    "plainLanguageExplanation",
    "problemBeingAddressed",
    "technologyApproach",
    "maritimeRelevance",
    "possibleApplication",
    "whyItMatters",
    "followUpOrActionSignal",
    "limitations",
  ];
  requiredDetailFields.forEach((field) => {
    if (!files.galleryDetail.includes(field)) {
      failures.push(`ResearchGalleryDetail.jsx: does not reference required field "${field}".`);
    }
  });

  // 5. Empty sections must be hidden, not printed as blank headings -
  // spot-check the two "hide if empty" patterns the detail page relies on.
  if (!/function ExplanationSection/.test(files.galleryDetail) || !/return null/.test(files.galleryDetail)) {
    failures.push("ResearchGalleryDetail.jsx: ExplanationSection must return null for empty fields (no blank headings).");
  }

  // 6. Flag rendering must have a non-emoji fallback (never blank / broken image).
  if (!/getFlagEmoji/.test(files.countryFlagBadge) || !/Globe2/.test(files.countryFlagBadge)) {
    failures.push("CountryFlagBadge.jsx: must fall back to a plain icon when no valid flag emoji can be derived from the country code.");
  }

  // 7. The one seam every check above depends on must still read the
  // display-eligible-only file, not the full record set.
  if (!/display-records\.json/.test(files.galleryData)) {
    failures.push("researchGalleryData.js: must import data/processed/display-records.json.");
  }
  if (/["'`][^"'`]*\/research-records\.json["'`]/.test(files.galleryData)) {
    failures.push("researchGalleryData.js: must not import the full research-records.json.");
  }

  return { ok: failures.length === 0, failures, warnings };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Frontend Display Flow Verification");
  console.log("=".repeat(60));
  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.forEach((f) => console.log(`  ✗ ${f}`));
  } else {
    console.log("All checks passed.");
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifyFrontendDisplayFlow();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:frontend-display-flow:", error);
    process.exitCode = 1;
  });
}
