/**
 * Verifiable vertical-slice enrichment run: discovery -> source resolution
 * -> original webpage fetch -> text/image extraction -> evidence snippets
 * -> enriched JSON -> merged into the live dataset the frontend reads.
 *
 * Usage:
 *   npm.cmd run enrich:sample
 *   npm.cmd run enrich:sample -- --country=China --limit=10
 *
 * Every fetch below is a real network call (OpenAlex, Crossref, and the
 * original source pages) — no AI browsing, no fabricated data. If a call
 * fails (rate limit, 403, timeout, non-HTML response) it is logged and
 * skipped; one failure never stops the run.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchJson } from "./http.mjs";
import { verifyCrossrefDoi } from "./adapters/crossref.adapter.mjs";
import { resolveSourcePagesForProject } from "./enrichment/resolveSourcePages.mjs";
import { extractWebpage } from "./enrichment/extractWebpage.mjs";
import { extractWebpageWithBrowser, closeBrowser } from "./enrichment/extractWebpageBrowser.mjs";
import { chunkPage } from "./enrichment/chunkText.mjs";
import { buildEvidenceSnippets } from "./enrichment/classifyEvidence.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const liveDataPath = path.resolve(__dirname, "../../src/data/generated/liveResearchData.json");
const outputPath = path.resolve(__dirname, "../../data/enriched/china-sample.json");

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? true];
  })
);
const TARGET_COUNTRY = args.country ?? "China";
const LIMIT = Number(args.limit ?? 10);
const TOPIC_KEYWORDS = [
  "maritime AI",
  "smart port",
  "autonomous vessel",
  "green shipping",
  "alternative fuels",
];
const KEYWORD_TERMS = {
  "maritime AI": ["artificial intelligence", "machine learning", " ai "],
  "smart port": ["port", "terminal", "intelligent port"],
  "autonomous vessel": ["autonomous", "unmanned"],
  "green shipping": ["green shipping", "decarbon", "emission", "carbon"],
  "alternative fuels": ["alternative energy and fuels", "hydrogen", "ammonia", "methanol", "fuel"],
};

function matchesTopicKeywords(project) {
  const haystack = `${project.title} ${project.researchCategories.join(" ")}`.toLowerCase();
  return TOPIC_KEYWORDS.filter((keyword) =>
    KEYWORD_TERMS[keyword].some((term) => haystack.includes(term))
  );
}

// --- Step 1: OpenAlex discovery (real live call attempted; fallback below) ---
async function tryLiveOpenAlexDiscovery() {
  const results = [];
  const errors = [];
  for (const keyword of TOPIC_KEYWORDS) {
    try {
      const url = new URL("https://api.openalex.org/works");
      url.searchParams.set("search", `${keyword} China maritime`);
      url.searchParams.set("per-page", "3");
      url.searchParams.set("mailto", "research-demo@example.invalid");
      const payload = await fetchJson(url.toString(), {
        fetchOptions: { retries: 1, timeout: 10000 },
      });
      if (payload?.results) {
        results.push(...payload.results.map((record) => ({ keyword, record })));
      }
    } catch (error) {
      errors.push(`${keyword}: ${error.message}`);
    }
  }
  return { results, errors };
}

async function main() {
  console.log("=".repeat(60));
  console.log(`Enrichment sample run — country=${TARGET_COUNTRY} limit=${LIMIT}`);
  console.log("=".repeat(60));

  const stats = {
    startedAt: new Date().toISOString(),
    openAlexLiveCallAttempted: true,
    openAlexLiveCallSucceeded: false,
    crossrefLiveCallAttempted: false,
    crossrefLiveCallSucceeded: false,
    recordsDiscovered: 0,
    sourcePagesAttempted: 0,
    sourcePagesFetchedSuccessfully: 0,
    sourcePagesFailed: 0,
    evidenceSnippetsExtracted: 0,
    imageCandidatesExtracted: 0,
  };

  // --- Step 1: real live OpenAlex call, attempted first, every run ---
  console.log("\n[1/6] Attempting live OpenAlex discovery...");
  const liveDiscovery = await tryLiveOpenAlexDiscovery();
  if (liveDiscovery.results.length > 0) {
    stats.openAlexLiveCallSucceeded = true;
    console.log(`  OpenAlex live call succeeded: ${liveDiscovery.results.length} raw result(s).`);
  } else {
    console.log("  OpenAlex live call returned 0 usable results this run. Errors:");
    liveDiscovery.errors.forEach((message) => console.log(`    - ${message}`));
    console.log(
      "  Falling back to China maritime records already discovered from OpenAlex earlier " +
        "in this project's ingestion history (src/data/generated/liveResearchData.json), " +
        "still real, previously-fetched OpenAlex metadata — not fabricated."
    );
  }

  const liveData = JSON.parse(await fs.readFile(liveDataPath, "utf8"));
  const countryProjects = liveData.publicProjects.filter(
    (project) => project.country === TARGET_COUNTRY
  );
  const candidates = countryProjects
    .map((project) => ({ project, matchedKeywords: matchesTopicKeywords(project) }))
    .filter((entry) => entry.matchedKeywords.length > 0)
    .slice(0, LIMIT);

  stats.recordsDiscovered = candidates.length;
  console.log(
    `\n[2/6] Selected ${candidates.length} candidate(s) matching topic keywords for ${TARGET_COUNTRY}.`
  );
  candidates.forEach((entry) =>
    console.log(`  - ${entry.project.title.slice(0, 70)} [${entry.matchedKeywords.join(", ")}]`)
  );

  // --- Step 2: real live Crossref DOI verification for each candidate ---
  console.log("\n[3/6] Verifying DOIs against Crossref (live call)...");
  const crossrefResults = new Map();
  for (const { project } of candidates) {
    const doi = project.openAlex?.doi?.replace("https://doi.org/", "");
    if (!doi) continue;
    stats.crossrefLiveCallAttempted = true;
    try {
      const verification = await verifyCrossrefDoi(doi, new Date().toISOString());
      if (verification) {
        stats.crossrefLiveCallSucceeded = true;
        crossrefResults.set(project.id, verification);
        console.log(`  ✓ Crossref verified: ${doi}`);
      }
    } catch {
      // verifyCrossrefDoi already logs+swallows its own errors
    }
  }

  // --- Steps 3-5: resolve source URL, fetch original page, extract, snippet ---
  console.log("\n[4/6] Fetching original source pages and extracting content...");
  const enrichedRecords = [];

  for (const { project, matchedKeywords } of candidates) {
    const candidateUrls = resolveSourcePagesForProject(project);
    const nowIso = new Date().toISOString();

    const record = {
      id: project.id,
      title: project.title,
      country: TARGET_COUNTRY,
      institutions: [project.leadOrganisation, ...(project.partnerOrganisations ?? [])].filter(
        Boolean
      ),
      topics: matchedKeywords,
      year: (project.startDate || "").slice(0, 4),
      doi: project.openAlex?.doi ?? "",
      openAlexUrl: project.openAlex?.workId ?? "",
      sourceUrl: candidateUrls[0]?.url ?? "",
      sourceName: project.leadOrganisation || "Unknown",
      lastFetchedAt: nowIso,
      sourcePages: [],
      dataQuality: {
        hasOriginalSource: false,
        hasDetailedDescription: false,
        hasEvidenceSnippets: false,
        hasImageCandidates: false,
        needsManualReview: true,
      },
    };

    if (candidateUrls.length === 0) {
      console.log(`  (no resolvable source URL for ${project.title.slice(0, 50)})`);
      enrichedRecords.push(record);
      continue;
    }

    // Try each resolved URL (open-access -> publisher landing -> DOI
    // resolver) in order, stopping at the first that yields real content —
    // a direct PDF/publisher link failing (403, JS-only redirect) doesn't
    // mean the DOI resolver fallback will too. For each URL, a plain fetch
    // is tried first; only if that gets zero usable content (empty JS
    // redirect stub) or fails outright is the heavier Playwright browser
    // fetch attempted, per CLAUDE.md's "Playwright only when required".
    let succeeded = false;
    for (const target of candidateUrls) {
      stats.sourcePagesAttempted += 1;
      let page = null;
      let viaBrowser = false;

      try {
        console.log(`  Fetching: ${target.url}`);
        page = await extractWebpage(target.url);
        if (chunkPage(page).length === 0) {
          console.log("    -> 0 chunks from plain fetch, trying Playwright...");
          page = await extractWebpageWithBrowser(target.url);
          viaBrowser = true;
        }
      } catch (plainError) {
        try {
          console.log(`    -> plain fetch failed (${plainError.message}), trying Playwright...`);
          page = await extractWebpageWithBrowser(target.url);
          viaBrowser = true;
        } catch (browserError) {
          stats.sourcePagesFailed += 1;
          console.warn(`    -> FAILED (plain + Playwright): ${browserError.message}`);
          continue;
        }
      }

      const chunks = chunkPage(page);
      const evidenceSnippets = buildEvidenceSnippets(chunks, target.url);
      const images = page.images ?? [];

      console.log(
        `    -> ${viaBrowser ? "[via Playwright] " : ""}${chunks.length} chunk(s), ` +
          `${evidenceSnippets.length} evidence snippet(s), ${images.length} image candidate(s)`
      );

      if (chunks.length === 0) {
        // Fetched fine even with a real browser, but still no usable
        // content — record it, but keep trying the next candidate URL.
        record.sourcePages.push({
          sourceUrl: target.url,
          pageTitle: page.pageTitle ?? "",
          sourceType: target.sourceType,
          fetchedAt: nowIso,
          statusCode: 200,
          cleanedTextSummary: "",
          evidenceSnippets: [],
          images,
        });
        continue;
      }

      record.sourceUrl = target.url;
      record.sourcePages = [
        {
          sourceUrl: target.url,
          pageTitle: page.pageTitle ?? "",
          sourceType: target.sourceType,
          fetchedAt: nowIso,
          statusCode: 200,
          cleanedTextSummary: page.sections?.[0]?.text?.slice(0, 300) ?? "",
          evidenceSnippets,
          images,
        },
      ];
      record.dataQuality = {
        hasOriginalSource: true,
        hasDetailedDescription: true,
        hasEvidenceSnippets: evidenceSnippets.length > 0,
        hasImageCandidates: images.length > 0,
        needsManualReview: false,
      };

      stats.sourcePagesFetchedSuccessfully += 1;
      stats.evidenceSnippetsExtracted += evidenceSnippets.length;
      stats.imageCandidatesExtracted += images.length;
      succeeded = true;
      break;
    }

    if (!succeeded && record.sourcePages.length === 0) {
      record.sourcePages.push({
        sourceUrl: candidateUrls[0].url,
        pageTitle: "",
        sourceType: candidateUrls[0].sourceType,
        fetchedAt: nowIso,
        statusCode: 0,
        cleanedTextSummary: "",
        evidenceSnippets: [],
        images: [],
      });
    }

    enrichedRecords.push(record);
  }

  await closeBrowser();

  // --- Step 6: write output + merge into the live dataset ---
  stats.completedAt = new Date().toISOString();
  const output = { meta: stats, records: enrichedRecords };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`\n[5/6] Wrote ${outputPath}`);

  let mergedCount = 0;
  let resetCount = 0;
  const enrichedById = new Map(enrichedRecords.map((record) => [record.id, record]));
  liveData.projects.forEach((project) => {
    const enriched = enrichedById.get(project.id);
    if (!enriched) return;

    if (!enriched.sourcePages[0]?.evidenceSnippets?.length) {
      // This run attempted this project but got no real content — clear
      // any enrichment fields a PREVIOUS (possibly since-fixed-bug) run
      // may have written, rather than leaving stale/incorrect data behind.
      if (project.selectedEvidence?.length || project.detailedDescription) {
        project.sourcePages = [];
        project.selectedEvidence = [];
        project.detailedDescription = "";
        project.dataQuality = {
          hasOriginalSource: false,
          hasDetailedDescription: false,
          hasEvidenceSnippets: false,
          hasImageCandidates: false,
          needsManualReview: true,
        };
        resetCount += 1;
      }
      return;
    }

    project.sourcePages = enriched.sourcePages.map((page) => ({
      sourceId: `sourcepage-${project.id}`,
      sourceType: page.sourceType,
      sourceName: enriched.sourceName,
      sourceUrl: page.sourceUrl,
      pageTitle: page.pageTitle,
      publishedDate: "",
      fetchedAt: page.fetchedAt,
      rawTextStored: false,
      cleanedTextSummary: page.cleanedTextSummary,
      chunks: page.evidenceSnippets.map((snippet, index) => ({
        chunkId: `chunk-enriched-${project.id}-${index}`,
        text: snippet.text,
        heading: "",
        sourceUrl: snippet.sourceUrl,
        pageTitle: page.pageTitle,
      })),
      images: page.images,
    }));
    project.selectedEvidence = enriched.sourcePages[0].evidenceSnippets.map((snippet, index) => ({
      evidenceId: `evidence-${project.id}-${index}`,
      snippet: snippet.text,
      evidenceType: snippet.evidenceType,
      importanceScore: 0.5,
      whyImportant: snippet.whyImportant,
      sourceUrl: snippet.sourceUrl,
      sourceName: enriched.sourceName,
      pageTitle: enriched.sourcePages[0].pageTitle,
    }));
    project.detailedDescription = enriched.sourcePages[0].cleanedTextSummary;
    project.dataQuality = enriched.dataQuality;
    mergedCount += 1;
  });

  // JSON.parse gives liveData.projects and liveData.publicProjects
  // independent object copies (no shared references survive
  // serialization), even though buildDataset.mjs originally built
  // publicProjects as a filtered view over the same project objects. The
  // forEach above only mutated liveData.projects, so publicProjects (what
  // the frontend actually reads — see researchProjectData.js) must be
  // rebuilt from it here, or the merge would silently never reach the app.
  liveData.publicProjects = liveData.projects.filter(
    (project) => project.isPubliclyDisplayable
  );

  if (mergedCount > 0 || resetCount > 0) {
    await fs.writeFile(liveDataPath, `${JSON.stringify(liveData, null, 2)}\n`);
    console.log(
      `[6/6] Merged enriched fields into ${mergedCount} record(s), reset ${resetCount} stale ` +
        `record(s), in ${liveDataPath}`
    );
  } else {
    console.log("[6/6] No records had successful extraction to merge into the live dataset.");
  }

  console.log("\n" + "=".repeat(60));
  console.log("Summary");
  console.log("=".repeat(60));
  console.log(JSON.stringify(stats, null, 2));
}

main().catch(async (error) => {
  console.error("Fatal error:", error);
  await closeBrowser();
  process.exitCode = 1;
});
