import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import liveResearchData from "../../src/data/generated/liveResearchData.json" with { type: "json" };
import displayRecordsData from "../../data/processed/display-records.json" with { type: "json" };
import { institutionImageRegistry } from "../../src/data/institutionImageRegistry.js";
import countryRegistryData from "../../src/data/generated/countryRegistry.json" with { type: "json" };

// Auto-detects institutions from the app's actual research data (the
// legacy institutions directory AND the real-pipeline display-records.json
// gallery records) and builds ONE registry both datasets, and every image
// mechanism, can key off of - so adding a new record automatically makes
// its institution show up here on the next build, rather than needing a
// manual edit.
//
// Matching/merge rule: exact normalized-name match only (case/punctuation/
// whitespace-insensitive). Two institutions that are probably the same
// but don't normalize identically (e.g. "SINTEF Ocean" vs "SINTEF OCEAN
// AS") are kept as SEPARATE entries rather than guessed-merged - an alias
// is only recorded when the SAME normalized name is seen from more than
// one source record, never inferred from similarity.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const outputPath = path.join(rootDir, "src/data/generated/institutionRegistry.json");

function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90);
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

export async function buildInstitutionRegistry({ log = console.log } = {}) {
  const countryByCode = new Map((countryRegistryData.countries ?? []).map((c) => [c.iso2, c]));
  const imageByNormalizedName = new Map(institutionImageRegistry.map((img) => [normalizeName(img.institutionName), img]));

  const projects = liveResearchData.publicProjects ?? liveResearchData.projects ?? [];
  const legacyInstitutions = liveResearchData.institutions ?? [];

  const byNormalizedName = new Map();
  const duplicateReport = [];

  function upsert(rawName, { country, countryIso2, institutionType, officialWebsite, sourceRecordId } = {}) {
    if (!rawName || !rawName.trim()) return null;
    const key = normalizeName(rawName);
    if (!key) return null;

    let entry = byNormalizedName.get(key);
    if (!entry) {
      entry = {
        institutionName: rawName.trim(),
        normalizedName: key,
        slug: slugify(rawName),
        aliases: [],
        country: country ?? null,
        countryIso2: countryIso2 ?? null,
        institutionType: institutionType ?? "unknown",
        officialWebsite: officialWebsite ?? null,
        officialDomain: officialWebsite ? hostnameOf(officialWebsite) : null,
        sourceRecords: [],
        recordCount: 0,
        imageStatus: "not-searched",
        imageAssetPath: null,
        imageSourceUrl: null,
        imageType: null,
        confidence: null,
      };
      byNormalizedName.set(key, entry);
    } else if (entry.institutionName !== rawName.trim() && !entry.aliases.includes(rawName.trim())) {
      // Same normalized identity, different exact spelling seen elsewhere -
      // recorded as an alias, never silently swapped in as the canonical name.
      entry.aliases.push(rawName.trim());
      duplicateReport.push({ canonicalName: entry.institutionName, alias: rawName.trim() });
    }

    if (!entry.country && country) entry.country = country;
    if (!entry.countryIso2 && countryIso2) entry.countryIso2 = countryIso2;
    if (entry.institutionType === "unknown" && institutionType) entry.institutionType = institutionType;
    if (!entry.officialWebsite && officialWebsite) {
      entry.officialWebsite = officialWebsite;
      entry.officialDomain = hostnameOf(officialWebsite);
    }
    if (sourceRecordId && !entry.sourceRecords.includes(sourceRecordId)) {
      entry.sourceRecords.push(sourceRecordId);
      entry.recordCount = entry.sourceRecords.length;
    }
    return entry;
  }

  // 1. Seed from the legacy institutions directory - already-curated
  // country/type/website fields where present.
  legacyInstitutions.forEach((institution) => {
    const countryEntry = countryByCode.get(institution.countryCode);
    upsert(institution.canonicalName, {
      country: countryEntry?.countryName ?? null,
      countryIso2: institution.countryCode ?? null,
      institutionType: institution.institutionType,
      officialWebsite: institution.website || null,
    });
  });

  // 2. Attribute every legacy project to its lead/partner institution(s) -
  // this is what makes recordCount and sourceRecords real, not guessed.
  projects.forEach((project) => {
    if (project.leadOrganisation) {
      upsert(project.leadOrganisation, { country: project.country, countryIso2: project.countryCode, sourceRecordId: project.id });
    }
    (project.partnerOrganisations ?? []).forEach((name) => {
      upsert(name, { sourceRecordId: project.id });
    });
  });

  // 3. Cross-reference the real-pipeline gallery records too (coordinator +
  // institutions[]) - these are ALREADY covered by the legacy list today
  // (verified before writing this script), but this keeps the registry
  // correct automatically if a future gallery-only institution appears.
  displayRecordsData.records.forEach((record) => {
    const countryEntry = countryByCode.get(record.countryCode);
    if (record.coordinator) {
      upsert(record.coordinator, { country: countryEntry?.countryName ?? record.countryOrRegion, countryIso2: record.countryCode, sourceRecordId: record.recordId });
    }
    (record.institutions ?? []).forEach((name) => {
      upsert(name, { sourceRecordId: record.recordId });
    });
  });

  // 4. Attach any already-accepted image (institutionImageRegistry.js) -
  // exact normalized-name match only, same rule as everywhere else.
  byNormalizedName.forEach((entry) => {
    const image = imageByNormalizedName.get(entry.normalizedName);
    if (image) {
      entry.imageStatus = "ready";
      entry.imageAssetPath = image.assetPath;
      entry.imageSourceUrl = image.imageSourceUrl;
      entry.imageType = image.imageType ?? "logo";
      entry.confidence = image.confidence;
    } else {
      entry.imageStatus = "pending";
    }
  });

  const entries = [...byNormalizedName.values()].sort((a, b) => b.recordCount - a.recordCount);

  const registry = {
    generatedAt: nowIso(),
    command: "build:institution-registry",
    totalInstitutions: entries.length,
    withRecords: entries.filter((e) => e.recordCount > 0).length,
    withOfficialWebsite: entries.filter((e) => e.officialWebsite).length,
    withImageReady: entries.filter((e) => e.imageStatus === "ready").length,
    duplicateAliasCount: duplicateReport.length,
    duplicateReport,
    institutions: entries,
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(registry, null, 2)}\n`);

  log(`Built registry: ${entries.length} institutions (${registry.withRecords} with records, ${registry.withImageReady} image-ready).`);
  return registry;
}

async function main() {
  const result = await buildInstitutionRegistry();
  console.log("\n" + "=".repeat(60));
  console.log("Institution Registry Build Summary");
  console.log("=".repeat(60));
  console.log(`Total institutions:       ${result.totalInstitutions}`);
  console.log(`With research records:    ${result.withRecords}`);
  console.log(`With official website:    ${result.withOfficialWebsite}`);
  console.log(`With image ready:         ${result.withImageReady}`);
  console.log(`Aliases recorded:         ${result.duplicateAliasCount}`);
  if (result.duplicateReport.length) {
    result.duplicateReport.forEach((d) => console.log(`  - "${d.alias}" is an alias of "${d.canonicalName}"`));
  }
  console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during build:institution-registry:", error);
    process.exitCode = 1;
  });
}
