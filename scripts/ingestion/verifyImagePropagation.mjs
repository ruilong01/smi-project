import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findPropagatedImage } from "../../src/data/researchImageMatcher.js";
import { getImageBackedRecordCount } from "../../src/data/imageProvenanceRegistry.js";
import { publicResearchProjects, projectHasRealImage, getPropagatedGalleryImage } from "../../src/data/researchProjectData.js";

// Gate for "a real image already verified in Research Gallery must
// propagate onto the main country/institution/research-detail journey,
// but only when the match is unambiguous" (see
// src/data/researchImageMatcher.js). This is a read-only frontend-logic
// check - it imports the actual matcher/registry/data-seam modules and
// runs them against the real current dataset, so a regression in the
// matching rules (or in what counts as "image-ready") fails here, not
// just in the browser. Never writes to any file.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const REQUIRED_PROPAGATION_FIELDS = [
  "imageUrl",
  "imageSourceUrl",
  "imageSourceName",
  "rightsNote",
  "imageMatchMethod",
  "imageMatchConfidence",
  "imageProvenanceReason",
];

export async function verifyImagePropagation() {
  const failures = [];
  const warnings = [];
  const counts = {
    imageBackedGalleryRecords: getImageBackedRecordCount(),
    legacyProjectsWithOwnImage: 0,
    legacyProjectsWithPropagatedImage: 0,
    legacyProjectsImageReady: 0,
    legacyProjectsTotal: publicResearchProjects.length,
  };

  // 1 & 4. Every legacy project's image-readiness must be explainable:
  // either it has its own sourcePages image, or a safe propagated match,
  // or neither (and then it must NOT count as image-ready).
  publicResearchProjects.forEach((project) => {
    const ownImage = (project.sourcePages ?? []).some((page) => (page.images ?? []).some((image) => image.imageUrl));
    const propagated = getPropagatedGalleryImage(project);
    const isReady = projectHasRealImage(project);

    if (ownImage) counts.legacyProjectsWithOwnImage++;
    if (propagated) counts.legacyProjectsWithPropagatedImage++;
    if (isReady) counts.legacyProjectsImageReady++;

    if (!ownImage && !propagated && isReady) {
      failures.push(`Project ${project.id} has neither an own image nor a propagated match, but projectHasRealImage() says true.`);
    }
    if ((ownImage || propagated) && !isReady) {
      failures.push(`Project ${project.id} has an image (own or propagated) but projectHasRealImage() says false.`);
    }

    // 2. Every propagated result must carry full provenance metadata -
    // never attach an image without saying where it came from and how
    // confident the match is.
    if (propagated) {
      REQUIRED_PROPAGATION_FIELDS.forEach((field) => {
        if (!propagated[field]) {
          failures.push(`Propagated image for project ${project.id} is missing required field "${field}".`);
        }
      });
    }
  });

  if (counts.legacyProjectsWithPropagatedImage === 0) {
    failures.push(
      "No legacy project resolved a propagated Research Gallery image - expected at least the known GAMMA (Iceland/VERKIS HF) and SINTEF Ocean (Norway) matches to succeed."
    );
  }

  // 3. Uncertain / no-match cases must return null, never a guess.
  const noMatch = findPropagatedImage({ title: "A record title that does not exist anywhere in the dataset xyz123" });
  if (noMatch !== null) {
    failures.push("findPropagatedImage() returned a match for a title that does not exist in the gallery dataset - it must return null for no match.");
  }
  const emptyQuery = findPropagatedImage({});
  if (emptyQuery !== null) {
    failures.push("findPropagatedImage() returned a match for an empty query - it must return null when no identifying information is given.");
  }

  // 5. This module set must never write to disk - a pure, read-only
  // matching layer over data already produced elsewhere.
  const filesToScanForWrites = [
    path.join(rootDir, "src/data/researchImageMatcher.js"),
    path.join(rootDir, "src/data/imageProvenanceRegistry.js"),
  ];
  for (const filePath of filesToScanForWrites) {
    const content = await fs.readFile(filePath, "utf8");
    if (/fs\.write|writeFile|createWriteStream/.test(content)) {
      failures.push(`${path.relative(rootDir, filePath)} appears to write to disk - the propagation layer must stay read-only.`);
    }
  }

  return { ok: failures.length === 0, failures, warnings, counts };
}

function printReport(result) {
  console.log("\n" + "=".repeat(60));
  console.log("Image Propagation Verification");
  console.log("=".repeat(60));
  console.log(`Image-backed gallery records:         ${result.counts.imageBackedGalleryRecords}`);
  console.log(`Legacy projects (total):              ${result.counts.legacyProjectsTotal}`);
  console.log(`Legacy projects with own image:        ${result.counts.legacyProjectsWithOwnImage}`);
  console.log(`Legacy projects with propagated image: ${result.counts.legacyProjectsWithPropagatedImage}`);
  console.log(`Legacy projects image-ready (total):   ${result.counts.legacyProjectsImageReady}`);
  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }
  if (result.failures.length) {
    console.log("\nFailures:");
    result.failures.forEach((f) => console.log(`  ✗ ${f}`));
  } else {
    console.log("\nAll checks passed.");
  }
  console.log("=".repeat(60) + "\n");
}

async function main() {
  const result = await verifyImagePropagation();
  printReport(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during verify:image-propagation:", error);
    process.exitCode = 1;
  });
}
