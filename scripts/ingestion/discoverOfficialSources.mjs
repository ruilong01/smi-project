import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractWebpage } from "./enrichment/extractWebpage.mjs";
import { fetchText, delayMs } from "./http.mjs";
import { classifySourceDiscoveryUrl } from "../processing/sourceDiscoveryClassifier.mjs";
import { buildTriageOutputFiles } from "./triageRecords.mjs";

// Processes data/processed/source-discovery-queue.json: for each queued
// record, builds candidate OFFICIAL source URLs from data we already have
// - never a blind web search - classifies each one, and only records a
// candidate as "selected" once its page has actually been confirmed to
// exist (fetched successfully, or confirmed via a real public API).
//
// Two deterministic discovery methods are implemented (both real, public,
// non-scraping per CLAUDE.md's "public APIs, RSS, requests... only"
// architecture rule):
//   1. CORDIS project sub-pages (e.g. .../results) - the record's own
//      CORDIS project id, just a different tab of the same official page.
//   2. OpenAIRE, via its real REST API (api.openaire.eu/search/projects) -
//      NOT the explore.openaire.eu human search UI, which sits behind a
//      "prove you're human" bot-detection interstitial (confirmed by
//      direct testing) and can never be scraped for images. The API
//      confirms whether OpenAIRE actually has the project on file; if so,
//      its human page URL is still recorded for reference, but never
//      selected for image fetching since it can't actually be fetched.
//
// A third method - a real search-engine adapter for open-ended discovery
// (coordinator sites, consortium pages, press releases found by title/
// acronym) - is deliberately a no-op stub: no search API key exists yet
// (see CLAUDE.md/session rules - "Do not add API keys yet"). The
// interface exists so wiring one in later doesn't require touching the
// rest of this pipeline.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const defaultProcessedDir = path.join(rootDir, "data/processed");

const REQUEST_DELAY_MS = 1200;
const MAX_FETCH_RETRIES = 2;
const DEFAULT_LIMIT = 10;
const OPENALEX_CONTACT_EMAIL = "research-demo@example.invalid";

async function readJsonIfExists(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function cordisIdFor(recordId) {
  const match = /cordis-(\d+)/.exec(recordId ?? "");
  return match ? match[1] : null;
}

// ---- Discovery method 1: CORDIS sub-pages (deterministic_url) ----
function cordisSubPageCandidates(queueItem) {
  const cordisId = cordisIdFor(queueItem.recordId);
  if (!cordisId) return [];
  return [
    {
      url: `https://cordis.europa.eu/project/id/${cordisId}/results`,
      discoveryMethod: "deterministic_url",
      query: `CORDIS project id ${cordisId} -> /results sub-page`,
      candidateTitle: `${queueItem.title} - CORDIS Results`,
    },
  ];
}

// ---- Discovery method 2: OpenAIRE, via its real REST API ----
async function openaireCandidates(queueItem, log) {
  if (!queueItem.grantAgreementId) return { candidates: [], queried: false, query: null };

  const apiUrl = `https://api.openaire.eu/search/projects?grantID=${encodeURIComponent(queueItem.grantAgreementId)}`;
  const query = `OpenAIRE API grantID=${queueItem.grantAgreementId}`;
  try {
    const xml = await fetchText(apiUrl, {
      headers: { Accept: "application/xml, text/xml, */*;q=0.8" },
      fetchOptions: { email: OPENALEX_CONTACT_EMAIL, timeout: 15000, retries: MAX_FETCH_RETRIES, requestDelay: REQUEST_DELAY_MS },
    });
    const totalMatch = /<total>(\d+)<\/total>/.exec(xml);
    const total = totalMatch ? Number(totalMatch[1]) : 0;
    if (total === 0) {
      log(`    OpenAIRE API: no project found for grantID=${queueItem.grantAgreementId}`);
      return { candidates: [], queried: true, query };
    }

    const acronymMatch = /<acronym>([^<]*)<\/acronym>/.exec(xml);
    const explorePageUrl = `https://explore.openaire.eu/search/project?projectId=${encodeURIComponent(queueItem.grantAgreementId)}`;
    return {
      candidates: [
        {
          url: explorePageUrl,
          discoveryMethod: "deterministic_url",
          query,
          candidateTitle: `${acronymMatch?.[1] || queueItem.acronym || queueItem.title} - OpenAIRE`,
          verifiedViaApi: true,
        },
      ],
      queried: true,
      query,
    };
  } catch (error) {
    log(`    OpenAIRE API call failed: ${error.message}`);
    return { candidates: [], queried: true, query, error: error.message };
  }
}

// ---- Discovery method 3: search adapter (stub - no API key configured) ----
function searchAdapterCandidates() {
  // Deliberately a no-op. When a real search API is approved and
  // configured, this function is the ONE place to wire it in; every
  // caller already treats its result as "may be empty".
  return { candidates: [], queried: false };
}

async function verifyCandidatePage(url, log) {
  try {
    const result = await extractWebpage(url, { requestDelayMs: REQUEST_DELAY_MS, maxRetries: MAX_FETCH_RETRIES });
    return { ok: true, pageTitle: result.pageTitle };
  } catch (error) {
    log(`    verification fetch failed for ${url}: ${error.message}`);
    return { ok: false, error: error.message };
  }
}

let candidateCounter = 0;
function nextCandidateId(recordId) {
  candidateCounter++;
  return `${recordId}-source-${candidateCounter}`;
}

async function discoverForRecord(queueItem, nowIso, log) {
  const provenance = {
    queuedAt: queueItem.queuedAt ?? nowIso,
    discoveryMethodsUsed: [],
    queriesUsed: [],
    sourcePagesChecked: [],
    sourceCandidatesFound: [],
    sourceCandidatesAccepted: [],
    sourceCandidatesRejected: [],
    finalDecisionReason: "",
    limitations:
      "No live web-search API is configured yet (Do not add API keys yet) - only deterministic candidates built from this record's own CORDIS id/grant agreement id were checked; coordinator/consortium/press-release pages cannot be discovered automatically until a search adapter is wired in.",
  };

  const candidates = [];

  const cordisCands = cordisSubPageCandidates(queueItem);
  if (cordisCands.length) provenance.discoveryMethodsUsed.push("deterministic_url");
  candidates.push(...cordisCands);

  const { candidates: openaireCands, queried: openaireQueried, query: openaireQuery } = await openaireCandidates(queueItem, log);
  if (openaireQueried) {
    provenance.queriesUsed.push(openaireQuery);
    if (!provenance.discoveryMethodsUsed.includes("deterministic_url")) provenance.discoveryMethodsUsed.push("deterministic_url");
  }
  candidates.push(...openaireCands);

  const { candidates: searchCands, queried: searchQueried } = searchAdapterCandidates();
  candidates.push(...searchCands);
  if (searchQueried) provenance.discoveryMethodsUsed.push("search_result");

  const results = [];
  for (const [candidateIndex, candidate] of candidates.entries()) {
    const classification = classifySourceDiscoveryUrl(candidate.url);
    provenance.sourceCandidatesFound.push(candidate.url);

    if (!classification.fetchAllowed) {
      const entry = {
        sourceCandidateId: nextCandidateId(queueItem.recordId),
        recordId: queueItem.recordId,
        url: candidate.url,
        title: candidate.candidateTitle ?? "",
        snippet: "",
        sourceType: classification.category,
        sourceName: "",
        discoveryMethod: candidate.discoveryMethod,
        confidence: "low",
        selected: false,
        selectionReason: "",
        rejectionReason: classification.reason,
        discoveredAt: nowIso,
      };
      results.push(entry);
      provenance.sourceCandidatesRejected.push(candidate.url);
      continue;
    }

    // OpenAIRE's human page is confirmed (by direct testing) to sit behind
    // a bot-detection interstitial - recorded as a real, API-verified
    // reference, but never fetched/selected, since we cannot actually
    // retrieve its content.
    if (candidate.verifiedViaApi) {
      const entry = {
        sourceCandidateId: nextCandidateId(queueItem.recordId),
        recordId: queueItem.recordId,
        url: candidate.url,
        title: candidate.candidateTitle ?? "",
        snippet: "",
        sourceType: classification.category,
        sourceName: "OpenAIRE",
        discoveryMethod: candidate.discoveryMethod,
        confidence: "medium",
        selected: false,
        rejectionReason:
          "Project's existence in OpenAIRE was confirmed via api.openaire.eu, but its human-facing page (explore.openaire.eu) is behind a bot-detection interstitial and cannot be automatically fetched for images.",
        selectionReason: "",
        discoveredAt: nowIso,
      };
      results.push(entry);
      provenance.sourceCandidatesRejected.push(candidate.url);
      continue;
    }

    provenance.sourcePagesChecked.push(candidate.url);
    const verification = await verifyCandidatePage(candidate.url, log);
    if (!verification.ok) {
      const entry = {
        sourceCandidateId: nextCandidateId(queueItem.recordId),
        recordId: queueItem.recordId,
        url: candidate.url,
        title: candidate.candidateTitle ?? "",
        snippet: "",
        sourceType: classification.category,
        sourceName: "",
        discoveryMethod: candidate.discoveryMethod,
        confidence: "low",
        selected: false,
        selectionReason: "",
        rejectionReason: `Page did not resolve: ${verification.error}`,
        discoveredAt: nowIso,
      };
      results.push(entry);
      provenance.sourceCandidatesRejected.push(candidate.url);
      continue;
    }

    const hostname = (() => {
      try {
        return new URL(candidate.url).hostname;
      } catch {
        return "unknown";
      }
    })();
    const entry = {
      sourceCandidateId: nextCandidateId(queueItem.recordId),
      recordId: queueItem.recordId,
      url: candidate.url,
      title: verification.pageTitle || candidate.candidateTitle || "",
      snippet: "",
      sourceType: classification.category,
      sourceName: hostname,
      discoveryMethod: candidate.discoveryMethod,
      confidence: "high",
      selected: true,
      selectionReason: `${classification.reason} Page confirmed to resolve via direct fetch.`,
      rejectionReason: "",
      discoveredAt: nowIso,
    };
    results.push(entry);
    provenance.sourceCandidatesAccepted.push(candidate.url);

    if (candidateIndex < candidates.length - 1) {
      await delayMs(REQUEST_DELAY_MS);
    }
  }

  if (candidates.length === 0) {
    provenance.finalDecisionReason =
      "No deterministic candidates could be constructed for this record (no CORDIS id, no grant agreement id) and no search adapter is configured.";
  } else if (provenance.sourceCandidatesAccepted.length > 0) {
    provenance.finalDecisionReason = `Accepted ${provenance.sourceCandidatesAccepted.length} of ${candidates.length} discovered candidate(s).`;
  } else {
    provenance.finalDecisionReason = `Found ${candidates.length} candidate(s), none accepted - see individual rejectionReason values.`;
  }

  return { results, provenance };
}

export async function discoverOfficialSources({
  processedDir = defaultProcessedDir,
  limit = DEFAULT_LIMIT,
  nowIso = new Date().toISOString(),
} = {}) {
  const log = (msg) => console.log(msg);

  const queueData = await readJsonIfExists(path.join(processedDir, "source-discovery-queue.json"), { queue: [] });
  const batch = (queueData.queue ?? []).slice(0, limit);

  const researchRecordsPath = path.join(processedDir, "research-records.json");
  const researchRecordsData = JSON.parse(await fs.readFile(researchRecordsPath, "utf8"));
  const previousRecords = researchRecordsData.records ?? [];
  const recordsById = new Map(previousRecords.map((r) => [r.recordId, r]));

  const existingCandidatesData = await readJsonIfExists(path.join(processedDir, "source-candidates.json"), { candidates: [] });
  const existingCandidates = existingCandidatesData.candidates ?? [];

  let attempted = 0;
  let candidatesFoundTotal = 0;
  let candidatesAcceptedTotal = 0;
  let candidatesRejectedTotal = 0;
  const newCandidates = [];
  const perRecordResults = [];

  for (const [index, queueItem] of batch.entries()) {
    const record = recordsById.get(queueItem.recordId);
    if (!record) {
      log(`  [${index + 1}/${batch.length}] skip - ${queueItem.recordId} not found in research-records.json`);
      continue;
    }

    attempted++;
    log(`  [${index + 1}/${batch.length}] ${queueItem.recordId} - ${queueItem.title?.slice(0, 60)}`);
    const { results, provenance } = await discoverForRecord(queueItem, nowIso, log);

    candidatesFoundTotal += provenance.sourceCandidatesFound.length;
    candidatesAcceptedTotal += provenance.sourceCandidatesAccepted.length;
    candidatesRejectedTotal += provenance.sourceCandidatesRejected.length;
    newCandidates.push(...results);

    const acceptedUrls = results.filter((r) => r.selected).map((r) => r.url);
    record.sourceDiscoveryProvenance = provenance;
    if (acceptedUrls.length > 0) {
      record.officialSourceCandidates = [...new Set([...(record.officialSourceCandidates ?? []), ...acceptedUrls])];
      record.discoveredSourceUrls = record.officialSourceCandidates;
      log(`    -> accepted ${acceptedUrls.length} official source candidate(s)`);
    } else {
      log(`    -> ${provenance.finalDecisionReason}`);
    }

    perRecordResults.push({
      recordId: queueItem.recordId,
      title: queueItem.title,
      candidatesFound: provenance.sourceCandidatesFound.length,
      candidatesAccepted: provenance.sourceCandidatesAccepted.length,
      candidatesRejected: provenance.sourceCandidatesRejected.length,
      finalDecisionReason: provenance.finalDecisionReason,
    });

    if (index < batch.length - 1) {
      await delayMs(REQUEST_DELAY_MS);
    }
  }

  // Re-triage for consistency (source discovery alone never adds images,
  // so this should never actually change display eligibility - but running
  // it keeps display-records.json/pending-image-enrichment.json in sync
  // with whatever changed on the records above, same as enrich:images does).
  const allRecords = [...recordsById.values()];
  const triageFiles = buildTriageOutputFiles(allRecords, { nowIso });

  const previousDisplayEligibleCount = previousRecords.filter((r) => r.displayEligible).length;
  const newDisplayEligibleCount = triageFiles["display-records.json"].recordCount;
  const validationProblems = [];
  if (allRecords.length !== previousRecords.length) {
    validationProblems.push(`Record count changed from ${previousRecords.length} to ${allRecords.length}.`);
  }
  if (newDisplayEligibleCount < previousDisplayEligibleCount) {
    validationProblems.push(`Display-eligible count dropped from ${previousDisplayEligibleCount} to ${newDisplayEligibleCount}.`);
  }
  // Source discovery must never itself grant display eligibility - only
  // enrich:images (a real image candidate) can do that.
  if (newDisplayEligibleCount !== previousDisplayEligibleCount) {
    validationProblems.push(
      `Display-eligible count changed from ${previousDisplayEligibleCount} to ${newDisplayEligibleCount} - source discovery must never change display eligibility by itself.`
    );
  }

  // Discovery is deterministic (the same record always yields the same
  // CORDIS/OpenAIRE URLs), so re-running against the same records would
  // otherwise just pile up identical duplicate candidates every time -
  // keep the LATEST entry per (recordId, url) pair instead.
  const candidateByKey = new Map();
  [...existingCandidates, ...newCandidates].forEach((candidate) => {
    candidateByKey.set(`${candidate.recordId}::${candidate.url}`, candidate);
  });
  const mergedCandidates = [...candidateByKey.values()];
  const candidatesOutput = {
    generatedAt: nowIso,
    candidateCount: mergedCandidates.length,
    candidates: mergedCandidates,
  };

  const filesToWrite = {
    "research-records.json": { ...researchRecordsData, generatedAt: nowIso, recordCount: allRecords.length, records: allRecords },
    ...triageFiles,
    "source-candidates.json": candidatesOutput,
  };

  let promoted = false;
  if (validationProblems.length === 0) {
    const runToken = Date.now();
    const tempPaths = Object.fromEntries(
      Object.keys(filesToWrite).map((fileName) => [fileName, path.join(processedDir, `.${fileName}.tmp-${runToken}`)])
    );
    for (const [fileName, content] of Object.entries(filesToWrite)) {
      await fs.writeFile(tempPaths[fileName], `${JSON.stringify(content, null, 2)}\n`);
    }
    for (const fileName of Object.keys(filesToWrite)) {
      const finalPath = path.join(processedDir, fileName);
      const backupPath = path.join(processedDir, `${fileName}.bak`);
      const previousExists = await fs.access(finalPath).then(() => true).catch(() => false);
      if (previousExists) {
        await fs.copyFile(finalPath, backupPath);
      }
      await fs.rename(tempPaths[fileName], finalPath);
    }
    promoted = true;
  } else {
    log("  VALIDATION FAILED - keeping previous files untouched:");
    validationProblems.forEach((p) => log(`    - ${p}`));
  }

  const report = {
    generatedAt: nowIso,
    limit,
    attempted,
    candidatesFoundTotal,
    candidatesAcceptedTotal,
    candidatesRejectedTotal,
    newCandidatesWritten: newCandidates.length,
    promoted,
    validationProblems,
    displayEligibleBefore: previousDisplayEligibleCount,
    displayEligibleAfter: promoted ? newDisplayEligibleCount : previousDisplayEligibleCount,
    entries: perRecordResults,
  };
  await fs.writeFile(
    path.join(processedDir, "source-discovery-report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );

  return report;
}

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      args[arg.slice(2)] = true;
    } else {
      args[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const limit = args.limit ? Number(args.limit) : DEFAULT_LIMIT;
  const result = await discoverOfficialSources({ limit });

  console.log("\n" + "=".repeat(60));
  console.log("Source Discovery Summary");
  console.log("=".repeat(60));
  console.log(`Attempted:                  ${result.attempted}`);
  console.log(`Candidates found:           ${result.candidatesFoundTotal}`);
  console.log(`Candidates accepted:        ${result.candidatesAcceptedTotal}`);
  console.log(`Candidates rejected:        ${result.candidatesRejectedTotal}`);
  console.log(`Display eligible: ${result.displayEligibleBefore} -> ${result.displayEligibleAfter}`);
  console.log(`Promoted to live files:     ${result.promoted}`);
  if (result.validationProblems.length) {
    console.log("Validation problems:");
    result.validationProblems.forEach((p) => console.log(`  - ${p}`));
  }
  console.log("=".repeat(60) + "\n");

  if (!result.promoted) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during discover:official-sources:", error);
    process.exitCode = 1;
  });
}
