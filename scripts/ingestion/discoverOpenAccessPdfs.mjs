import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import { fetchJson, fetchText, fetchRaw, delayMs } from "./http.mjs";
import { classifySourceCredibility } from "../processing/sourceCredibilityClassifier.mjs";
import { getSourceById } from "./globalSourceRegistry.mjs";
import { evaluateResearchRelevance } from "../processing/mockResearchRelevanceEvaluator.mjs";
import { evaluatePdfAccessPolicy } from "../processing/pdfAccessPolicy.mjs";
import countryRegistryData from "../../src/data/generated/countryRegistry.json" with { type: "json" };

// Free, legal, open-access PDF discovery + download pipeline (see
// docs/OPEN_ACCESS_PDF_INGESTION.md). Finds real maritime/ocean/port
// technology papers via free/open sources (OpenAlex, arXiv, Semantic
// Scholar, Unpaywall, CORE, Europe PMC), verifies legal open-access
// evidence, downloads PDFs to server-style storage
// (data/server/pdfs/{source}/{year}/{slug}.pdf), and stages metadata for
// later AI analysis. Never scrapes ResearchGate/Academia/Scribd, never
// bypasses a paywall/login/CAPTCHA, never touches
// data/processed/research-records.json or display-records.json, never
// installs a scheduler. Dry-run by default; writes require --write-staging
// / --download.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

const serverDir = path.join(rootDir, "data/server");
const stagingPath = path.join(serverDir, "staging/oa-pdf-candidates.json");
const manifestPath = path.join(serverDir, "runtime/pdf-download-manifest.json");
const scanStatusPath = path.join(serverDir, "runtime/oa-pdf-scan-status.json");
const logPath = path.join(serverDir, "logs/oa-pdf-ingestion.log");
const pdfDir = path.join(serverDir, "pdfs");
const productionRecordsPath = path.join(rootDir, "data/processed/research-records.json");

const CONTACT_EMAIL = process.env.CONTACT_EMAIL || process.env.OPENALEX_EMAIL || "research-demo@example.invalid";
const UNPAYWALL_EMAIL = process.env.UNPAYWALL_EMAIL || process.env.CONTACT_EMAIL || null;
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || null;
const CORE_API_KEY = process.env.CORE_API_KEY || null;
const SEMANTIC_SCHOLAR_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || null;

export const OA_PDF_TOPIC_QUERIES = [
  "maritime autonomy",
  "autonomous vessel",
  "smart port",
  "port automation",
  "port digital twin",
  "green shipping",
  "shipping decarbonisation",
  "ship emissions",
  "maritime cybersecurity",
  "maritime AI",
  "vessel traffic optimization",
  "marine robotics",
  "underwater robotics",
  "ocean monitoring",
  "ocean observation",
  "coastal resilience",
  "marine data platform",
  "marine renewable energy",
  "offshore wind maritime logistics",
  "ballast water treatment",
  "maritime safety technology",
  "seafarer safety technology",
  "autonomous underwater vehicle",
  "remotely operated vessel",
  "maritime satellite communication",
  "marine sensor network",
];

const DEFAULT_LIMIT = 30;
const DEFAULT_DOWNLOAD_LIMIT = 10;
const DEFAULT_PER_QUERY_PAGE_SIZE = 5;
const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25MB safety cap - a legitimate paper is never this large
const REQUEST_DELAY_MS = 1200;
const JITTER_MS = 400;

// Never fetched, regardless of any OA claim - explicit user rule.
const BLOCKED_HOST_PATTERN = /(^|\.)researchgate\.net$|(^|\.)academia\.edu$|(^|\.)scribd\.com$/i;

function nowIso() {
  return new Date().toISOString();
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeUrl(url) {
  return (url || "").trim().toLowerCase().replace(/\/$/, "");
}

function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function safeSlug(title, fallback) {
  const slug = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || (fallback || "untitled").toString().slice(0, 40);
}

function sha256Of(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function jitteredDelay() {
  return delayMs(REQUEST_DELAY_MS + Math.floor(Math.random() * JITTER_MS));
}

// OpenAlex returns abstracts as an inverted index, not plain text (see
// discoverResearchGlobal.mjs for the same technique/rationale).
function reconstructAbstract(invertedIndex) {
  if (!invertedIndex || typeof invertedIndex !== "object") return "";
  const positioned = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    positions.forEach((pos) => {
      positioned[pos] = word;
    });
  }
  return positioned.filter(Boolean).join(" ");
}

async function appendLog(message) {
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `[${nowIso()}] ${message}\n`);
}

// ============================================================================
// Discovery adapters - each takes a topic search term and returns a list of
// normalized candidates. Every adapter is independently safe to call with no
// API key (arXiv, OpenAlex, Semantic Scholar public tier, Europe PMC); CORE
// is skipped entirely when CORE_API_KEY is unset rather than guessing.
// ============================================================================

async function discoverOpenAlex({ topic, countryIso2, perPage, log }) {
  const params = new URLSearchParams({ search: topic, per_page: String(perPage), mailto: CONTACT_EMAIL });
  if (countryIso2) params.set("filter", `institutions.country_code:${countryIso2.toUpperCase()}`);
  if (OPENALEX_API_KEY) params.set("api_key", OPENALEX_API_KEY);
  const url = `https://api.openalex.org/works?${params.toString()}`;

  let data;
  try {
    data = await fetchJson(url, { fetchOptions: { email: CONTACT_EMAIL, retries: 3, timeout: 20000 } });
  } catch (error) {
    log(`  OpenAlex FAILED: ${error.message}`);
    return [];
  }

  return (data.results ?? []).map((work) => {
    const lead = work.authorships?.[0] ?? null;
    const institution = lead?.institutions?.[0];
    const doi = work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//i, "") : null;
    const openAccess = work.open_access ?? {};
    const bestOa = work.best_oa_location ?? {};
    const pdfUrl = bestOa.pdf_url || openAccess.oa_url || null;
    const isOpenAccess = Boolean(openAccess.is_oa && pdfUrl);
    return {
      title: work.title || "",
      abstract: reconstructAbstract(work.abstract_inverted_index),
      doi,
      year: work.publication_year ?? null,
      authors: (work.authorships ?? []).map((a) => a.author?.display_name).filter(Boolean),
      institutions: (work.authorships ?? []).flatMap((a) => (a.institutions ?? []).map((i) => i.display_name)).filter(Boolean),
      countries: (work.authorships ?? []).flatMap((a) => (a.institutions ?? []).map((i) => i.country_code)).filter(Boolean),
      sourceName: "OpenAlex",
      sourceUrl: work.doi || work.primary_location?.landing_page_url || work.id,
      pdfUrl,
      license: bestOa.license || null,
      isOpenAccess,
      oaEvidence: isOpenAccess ? `OpenAlex open_access.is_oa=true, pdf_url present (host_type=${bestOa.host_type || "unknown"})` : "",
      matchedQueryTopic: topic,
      topics: (work.concepts ?? []).slice(0, 5).map((c) => c.display_name),
      institution: institution?.display_name ?? null,
    };
  });
}

async function discoverArxiv({ topic, perPage, log }) {
  const params = new URLSearchParams({ search_query: `all:${topic}`, start: "0", max_results: String(perPage) });
  const url = `http://export.arxiv.org/api/query?${params.toString()}`;

  let xml;
  try {
    xml = await fetchText(url, { fetchOptions: { email: CONTACT_EMAIL, retries: 2, timeout: 20000 } });
  } catch (error) {
    log(`  arXiv FAILED: ${error.message}`);
    return [];
  }

  const $ = cheerio.load(xml, { xmlMode: true });
  const entries = [];
  $("entry").each((_, el) => {
    const $el = $(el);
    const id = $el.find("id").first().text().trim();
    const title = $el.find("title").first().text().replace(/\s+/g, " ").trim();
    const summary = $el.find("summary").first().text().replace(/\s+/g, " ").trim();
    const published = $el.find("published").first().text().trim();
    const authors = $el
      .find("author > name")
      .map((__, n) => $(n).text().trim())
      .get();
    const pdfLinkAttr = $el.find('link[title="pdf"]').attr("href");
    const pdfUrl = pdfLinkAttr || (id ? id.replace("/abs/", "/pdf/") : null);
    if (!title || !id) return;
    entries.push({
      title,
      abstract: summary,
      doi: null,
      year: published ? Number(published.slice(0, 4)) : null,
      authors,
      institutions: [],
      countries: [],
      sourceName: "arXiv",
      sourceUrl: id,
      pdfUrl,
      license: "arXiv.org perpetual, non-exclusive license",
      isOpenAccess: Boolean(pdfUrl),
      oaEvidence: pdfUrl ? "Official arXiv PDF (export.arxiv.org, arxiv.org/pdf/...)" : "",
      matchedQueryTopic: topic,
      topics: [],
      institution: null,
    });
  });
  return entries;
}

async function discoverSemanticScholar({ topic, perPage, log }) {
  const params = new URLSearchParams({
    query: topic,
    limit: String(perPage),
    fields: "title,abstract,year,externalIds,openAccessPdf,authors,fieldsOfStudy",
  });
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`;
  const headers = SEMANTIC_SCHOLAR_API_KEY ? { "x-api-key": SEMANTIC_SCHOLAR_API_KEY } : {};

  let data;
  try {
    data = await fetchJson(url, { headers, fetchOptions: { email: CONTACT_EMAIL, retries: 2, timeout: 20000 } });
  } catch (error) {
    log(`  Semantic Scholar FAILED: ${error.message}`);
    return [];
  }

  return (data.data ?? []).map((paper) => {
    const doi = paper.externalIds?.DOI || null;
    const pdfUrl = paper.openAccessPdf?.url || null;
    return {
      title: paper.title || "",
      abstract: paper.abstract || "",
      doi,
      year: paper.year ?? null,
      authors: (paper.authors ?? []).map((a) => a.name).filter(Boolean),
      institutions: [],
      countries: [],
      sourceName: "Semantic Scholar",
      sourceUrl: doi ? `https://doi.org/${doi}` : `https://www.semanticscholar.org/paper/${paper.paperId}`,
      pdfUrl,
      license: paper.openAccessPdf?.license || null,
      isOpenAccess: Boolean(pdfUrl),
      oaEvidence: pdfUrl ? "Semantic Scholar openAccessPdf.url" : "",
      matchedQueryTopic: topic,
      topics: paper.fieldsOfStudy || [],
      institution: null,
    };
  });
}

async function discoverCore({ topic, perPage, log }) {
  if (!CORE_API_KEY) return [];
  const url = `https://api.core.ac.uk/v3/search/works?q=${encodeURIComponent(topic)}&limit=${perPage}`;

  let data;
  try {
    data = await fetchJson(url, {
      headers: { Authorization: `Bearer ${CORE_API_KEY}` },
      fetchOptions: { email: CONTACT_EMAIL, retries: 2, timeout: 20000 },
    });
  } catch (error) {
    log(`  CORE FAILED: ${error.message}`);
    return [];
  }

  return (data.results ?? []).map((work) => {
    const pdfUrl = work.downloadUrl || work.sourceFulltextUrls?.[0] || null;
    return {
      title: work.title || "",
      abstract: work.abstract || "",
      doi: work.doi || null,
      year: work.yearPublished ?? null,
      authors: (work.authors ?? []).map((a) => a.name).filter(Boolean),
      institutions: [],
      countries: [],
      sourceName: "CORE",
      sourceUrl: work.doi ? `https://doi.org/${work.doi}` : work.links?.find((l) => l.type === "reader")?.url || pdfUrl || "",
      pdfUrl,
      license: null,
      isOpenAccess: Boolean(pdfUrl),
      oaEvidence: work.downloadUrl ? "CORE repository downloadUrl" : work.sourceFulltextUrls?.length ? "CORE sourceFulltextUrls (repository-hosted)" : "",
      matchedQueryTopic: topic,
      topics: [],
      institution: null,
    };
  });
}

async function discoverEuropePmc({ topic, perPage, log }) {
  const params = new URLSearchParams({
    query: `${topic} AND OPEN_ACCESS:Y`,
    format: "json",
    pageSize: String(perPage),
    resultType: "core",
  });
  const url = `https://www.ebi.ac.uk/europepmc/webservices/rest/search?${params.toString()}`;

  let data;
  try {
    data = await fetchJson(url, { fetchOptions: { email: CONTACT_EMAIL, retries: 2, timeout: 20000 } });
  } catch (error) {
    log(`  Europe PMC FAILED: ${error.message}`);
    return [];
  }

  return (data.resultList?.result ?? []).map((rec) => {
    const openPdf = (rec.fullTextUrlList?.fullTextUrl ?? []).find(
      (u) => u.documentStyle === "pdf" && /open/i.test(u.availability || "")
    );
    const pdfUrl = openPdf?.url || null;
    const isOpenAccess = rec.isOpenAccess === "Y" && Boolean(pdfUrl);
    return {
      title: rec.title || "",
      abstract: rec.abstractText || "",
      doi: rec.doi || null,
      year: rec.pubYear ? Number(rec.pubYear) : null,
      authors: rec.authorString ? rec.authorString.split(", ") : [],
      institutions: [],
      countries: [],
      sourceName: "Europe PMC",
      sourceUrl: rec.doi ? `https://doi.org/${rec.doi}` : `https://europepmc.org/article/${rec.source}/${rec.id}`,
      pdfUrl,
      license: rec.license || null,
      isOpenAccess,
      oaEvidence: isOpenAccess ? "Europe PMC isOpenAccess=Y with an open-availability fullTextUrl" : "",
      matchedQueryTopic: topic,
      topics: [],
      institution: null,
    };
  });
}

const DISCOVERY_ADAPTERS = {
  openalex: discoverOpenAlex,
  arxiv: discoverArxiv,
  "semantic-scholar": discoverSemanticScholar,
  core: discoverCore,
  "europe-pmc": discoverEuropePmc,
};

// Unpaywall is DOI-only enrichment, never a standalone discovery source -
// applied to any candidate that has a DOI but no confirmed OA PDF yet.
async function crossCheckUnpaywall(doi, log) {
  if (!UNPAYWALL_EMAIL || !doi) return null;
  const url = `https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(UNPAYWALL_EMAIL)}`;
  try {
    const data = await fetchJson(url, { fetchOptions: { email: UNPAYWALL_EMAIL, retries: 2, timeout: 20000 } });
    const loc = data.best_oa_location;
    if (data.is_oa && loc?.url_for_pdf) {
      return {
        pdfUrl: loc.url_for_pdf,
        license: loc.license || null,
        isOpenAccess: true,
        oaEvidence: `Unpaywall best_oa_location.url_for_pdf (host_type=${loc.host_type || "unknown"})`,
        sourceName: "Unpaywall-verified",
      };
    }
    return null;
  } catch (error) {
    log(`  Unpaywall FAILED for doi=${doi}: ${error.message}`);
    return null;
  }
}

function sourceAvailability() {
  return {
    openalex: { enabled: true, reason: "public API, no key required" },
    arxiv: { enabled: true, reason: "public API, no key required" },
    "semantic-scholar": {
      enabled: true,
      reason: SEMANTIC_SCHOLAR_API_KEY ? "SEMANTIC_SCHOLAR_API_KEY present" : "public tier, no key required (rate-limited without a key)",
    },
    "europe-pmc": { enabled: true, reason: "public API, no key required (open-access subset only)" },
    core: { enabled: Boolean(CORE_API_KEY), reason: CORE_API_KEY ? "CORE_API_KEY present" : "SKIPPED: CORE_API_KEY not set" },
    unpaywall: {
      enabled: Boolean(UNPAYWALL_EMAIL),
      reason: UNPAYWALL_EMAIL ? "UNPAYWALL_EMAIL/CONTACT_EMAIL present" : "SKIPPED: UNPAYWALL_EMAIL/CONTACT_EMAIL not set",
    },
  };
}

async function downloadPdf(candidate, existingShaSet, log) {
  const response = await fetchRaw(candidate.pdfUrl, { fetchOptions: { email: CONTACT_EMAIL, retries: 2, timeout: 20000 } });
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const contentLength = Number(response.headers.get("content-length") || 0);

  if (contentLength && contentLength > MAX_PDF_BYTES) {
    throw new Error(`file too large per content-length header (${contentLength} bytes > ${MAX_PDF_BYTES} max)`);
  }

  const looksLikePdf = contentType.includes("pdf") || (contentType.includes("octet-stream") && /\.pdf(\?|#|$)/i.test(candidate.pdfUrl));
  if (!looksLikePdf) {
    throw new Error(`content-type "${contentType}" is not a PDF`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error(`file too large (${buffer.byteLength} bytes > ${MAX_PDF_BYTES} max)`);
  }

  const sha256 = sha256Of(buffer);
  if (existingShaSet.has(sha256)) {
    return { duplicate: true, sha256 };
  }

  const sourceSlug = candidate.sourceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const year = candidate.year || "unknown-year";
  const dir = path.join(pdfDir, sourceSlug, String(year));
  await fs.mkdir(dir, { recursive: true });
  const filename = `${safeSlug(candidate.title, candidate.doi || sha256.slice(0, 12))}.pdf`;
  const filePath = path.join(dir, filename);
  await fs.writeFile(filePath, buffer);

  return {
    duplicate: false,
    relativePath: path.relative(rootDir, filePath).replace(/\\/g, "/"),
    size: buffer.byteLength,
    sha256,
  };
}

export async function discoverOpenAccessPdfs({
  limit = DEFAULT_LIMIT,
  downloadLimit = DEFAULT_DOWNLOAD_LIMIT,
  source,
  topic,
  country,
  writeStaging = false,
  download = false,
  dryRunExplicit = false,
  log = console.log,
} = {}) {
  const dryRun = dryRunExplicit ? true : !(writeStaging || download);
  const effectiveWriteStaging = writeStaging && !dryRun;
  const effectiveDownload = download && !dryRun && downloadLimit > 0;

  const openAlexSource = getSourceById("openalex");
  if (!openAlexSource?.enabled) {
    throw new Error('Source registry entry "openalex" is missing or not enabled - refusing to query a source the registry does not recognize as safe.');
  }

  const registryCountries = countryRegistryData.countries ?? [];
  const countryByIso2 = new Map(registryCountries.filter((c) => c.iso2).map((c) => [c.iso2, c]));

  let countryIso2 = null;
  if (country) {
    const entry = registryCountries.find((c) => c.countryName.toLowerCase() === country.toLowerCase());
    if (!entry?.iso2) {
      throw new Error(`Country "${country}" not found in the country registry, or has no ISO2 code - refusing to guess a filter.`);
    }
    countryIso2 = entry.iso2;
  }

  const availability = sourceAvailability();
  if (source && !DISCOVERY_ADAPTERS[source]) {
    throw new Error(`Unknown --source "${source}". Valid discovery sources: ${Object.keys(DISCOVERY_ADAPTERS).join(", ")}.`);
  }
  const activeSourceNames = source ? [source] : Object.keys(DISCOVERY_ADAPTERS);
  const topics = topic ? [topic] : OA_PDF_TOPIC_QUERIES;

  log(`  Sources: ${activeSourceNames.map((s) => `${s}${availability[s]?.enabled ? "" : " (skipped: " + availability[s]?.reason + ")"}`).join(", ")}`);
  log(`  Unpaywall enrichment: ${availability.unpaywall.enabled ? "enabled" : `disabled (${availability.unpaywall.reason})`}`);

  const productionRecords = (await readJsonIfExists(productionRecordsPath))?.records ?? [];
  const existingByUrl = new Set(
    productionRecords.flatMap((r) => (r.sourceUrls?.length ? r.sourceUrls : r.sourceUrl ? [r.sourceUrl] : [])).map(normalizeUrl)
  );

  const existingManifest = (await readJsonIfExists(manifestPath))?.downloads ?? [];
  const existingShaSet = new Set(existingManifest.map((d) => d.sha256).filter(Boolean));
  const existingPdfUrlSet = new Set(existingManifest.map((d) => normalizeUrl(d.pdfUrl)).filter(Boolean));

  // --- Discovery pass ---
  const rawCandidates = [];
  outer: for (const topicTerm of topics) {
    for (const sourceName of activeSourceNames) {
      if (rawCandidates.length >= limit) break outer;
      if (!availability[sourceName]?.enabled) continue;
      const adapter = DISCOVERY_ADAPTERS[sourceName];
      log(`[${sourceName}] searching "${topicTerm}"${countryIso2 ? ` (country=${countryIso2})` : ""}`);
      let results = [];
      try {
        results = await adapter({ topic: topicTerm, countryIso2, perPage: DEFAULT_PER_QUERY_PAGE_SIZE, log });
      } catch (error) {
        log(`  FAILED (${sourceName}): ${error.message}`);
      }
      rawCandidates.push(...results.slice(0, Math.max(0, limit - rawCandidates.length)));
      await jitteredDelay();
    }
  }

  // --- Dedup by DOI, else normalized title ---
  const byKey = new Map();
  for (const candidate of rawCandidates) {
    if (!candidate.title || !candidate.sourceUrl) continue;
    const key = candidate.doi ? `doi:${normalizeUrl(candidate.doi)}` : `title:${normalizeTitle(candidate.title)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
    } else if (!existing.pdfUrl && candidate.pdfUrl) {
      byKey.set(key, candidate);
    }
  }
  const deduped = [...byKey.values()];

  // --- Unpaywall enrichment for DOI-bearing candidates still missing a confirmed OA PDF ---
  if (availability.unpaywall.enabled) {
    for (const candidate of deduped) {
      if ((!candidate.pdfUrl || !candidate.isOpenAccess) && candidate.doi) {
        await jitteredDelay();
        const enrichment = await crossCheckUnpaywall(candidate.doi, log);
        if (enrichment) Object.assign(candidate, enrichment);
      }
    }
  }

  // --- Legality gate + relevance scoring ---
  const evaluated = deduped.map((candidate) => {
    const targetUrl = candidate.pdfUrl || candidate.sourceUrl;
    const hostname = hostnameOf(targetUrl);
    const urlKey = normalizeUrl(targetUrl);

    let status = "candidate";
    let rejectionReason = null;

    if (existingByUrl.has(normalizeUrl(candidate.sourceUrl))) {
      status = "rejected";
      rejectionReason = "duplicate: matches an existing production research record";
    } else if (hostname && BLOCKED_HOST_PATTERN.test(hostname)) {
      status = "rejected";
      rejectionReason = `blocked-source: ${hostname} (ResearchGate/Academia.edu/Scribd are never used, regardless of any OA claim)`;
    } else if (!candidate.pdfUrl || !candidate.isOpenAccess || !candidate.oaEvidence) {
      status = "rejected";
      rejectionReason = "no-legal-oa-pdf-found";
    }

    const credibility = classifySourceCredibility(candidate.sourceUrl);
    const resolvedCountry = candidate.countries?.[0] ? countryByIso2.get(candidate.countries[0])?.countryName ?? candidate.countries[0] : "unknown";
    const institution = candidate.institution ?? candidate.institutions?.[0] ?? "unknown";

    let relevance = { decision: "reject", score: 0, reason: "not evaluated - already rejected on legality grounds", matchedTerms: [], risks: [] };
    if (status !== "rejected") {
      relevance = evaluateResearchRelevance({
        title: candidate.title,
        abstract: candidate.abstract,
        topics: candidate.topics,
        matchedQueryTopic: candidate.matchedQueryTopic,
        sourceUrl: candidate.sourceUrl,
        sourceCredibilityTier: credibility.credibilityTier,
        isOpenAccess: candidate.isOpenAccess,
        oaEvidence: candidate.oaEvidence,
        institution,
        country: resolvedCountry,
      });
      if (relevance.decision === "reject") {
        status = "rejected";
        rejectionReason = `low-maritime-relevance: ${relevance.reason}`;
      } else if (relevance.decision === "review") {
        status = "review";
      }
    }

    if (status === "candidate" && existingPdfUrlSet.has(urlKey)) {
      status = "rejected";
      rejectionReason = "duplicate: this exact PDF URL was already downloaded in a previous run";
    }

    return {
      paperId: candidate.doi ? `doi:${candidate.doi}` : `${candidate.sourceName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${safeSlug(candidate.title)}`,
      title: candidate.title,
      doi: candidate.doi,
      year: candidate.year,
      authors: candidate.authors ?? [],
      institutions: candidate.institutions?.length ? candidate.institutions : institution !== "unknown" ? [institution] : [],
      countries: candidate.countries ?? [],
      country: resolvedCountry,
      sourceName: candidate.sourceName,
      sourceUrl: candidate.sourceUrl,
      pdfUrl: candidate.pdfUrl,
      license: candidate.license,
      isOpenAccess: Boolean(candidate.isOpenAccess),
      oaEvidence: candidate.oaEvidence || "",
      sourceCredibilityTier: credibility.credibilityTier,
      sourceAccessType: credibility.accessType,
      downloadedPath: null,
      downloadedAt: null,
      fileSizeBytes: 0,
      sha256: null,
      textExtractionStatus: "not_started",
      maritimeRelevanceScore: relevance.score,
      maritimeRelevanceReason: relevance.reason,
      matchedMaritimeTerms: relevance.matchedTerms,
      status,
      rejectionReason,
    };
  });

  // --- Controlled download pass ---
  let downloadedCount = 0;
  if (effectiveDownload) {
    const eligible = evaluated.filter((c) => c.status === "candidate").sort((a, b) => b.maritimeRelevanceScore - a.maritimeRelevanceScore);
    for (const candidate of eligible) {
      if (downloadedCount >= downloadLimit) break;
      await jitteredDelay();
      try {
        const result = await downloadPdf(candidate, existingShaSet, log);
        if (result.duplicate) {
          candidate.status = "rejected";
          candidate.rejectionReason = "duplicate: identical PDF content (sha256) already downloaded";
          await appendLog(`DUPLICATE "${candidate.title}" (sha256=${result.sha256})`);
          continue;
        }
        candidate.downloadedPath = result.relativePath;
        candidate.downloadedAt = nowIso();
        candidate.fileSizeBytes = result.size;
        candidate.sha256 = result.sha256;
        candidate.textExtractionStatus = "skipped";
        candidate.status = "downloaded";
        existingShaSet.add(result.sha256);
        existingPdfUrlSet.add(normalizeUrl(candidate.pdfUrl));
        downloadedCount++;
        log(`  Downloaded: ${candidate.title} -> ${result.relativePath} (${result.size} bytes)`);
        await appendLog(`DOWNLOADED "${candidate.title}" -> ${result.relativePath} (${result.size} bytes, sha256=${result.sha256}, oaEvidence=${candidate.oaEvidence})`);
      } catch (error) {
        candidate.status = "rejected";
        candidate.rejectionReason = `download-failed: ${error.message}`;
        log(`  Download FAILED: ${candidate.title}: ${error.message}`);
        await appendLog(`FAILED "${candidate.title}": ${error.message}`);
      }
    }
  }

  const report = {
    generatedAt: nowIso(),
    command: "discover:oa-pdfs",
    isTestOutput: true,
    dryRun,
    writeStagingRequested: writeStaging,
    downloadRequested: download,
    limit,
    downloadLimit,
    sourceFilter: source || null,
    topicFilter: topic || null,
    countryFilter: country || null,
    sourceAvailability: availability,
    candidatesFound: evaluated.length,
    acceptedCount: evaluated.filter((c) => c.status === "candidate" || c.status === "downloaded").length,
    reviewCount: evaluated.filter((c) => c.status === "review").length,
    rejectedCount: evaluated.filter((c) => c.status === "rejected").length,
    downloadedCount,
    candidates: evaluated,
  };

  if (effectiveWriteStaging) {
    await fs.mkdir(path.dirname(stagingPath), { recursive: true });
    await fs.writeFile(stagingPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  if (effectiveDownload) {
    const manifest = {
      generatedAt: nowIso(),
      isTestOutput: true,
      downloads: [
        ...existingManifest,
        ...evaluated
          .filter((c) => c.status === "downloaded")
          .map((c) => {
            // Persisted at download time (see docs/IN_APP_PDF_READER.md) so
            // the in-app PDF reader never has to re-derive access policy
            // from a staging file that gets overwritten on every run - the
            // manifest is the durable, append-only record.
            const policy = evaluatePdfAccessPolicy({
              license: c.license,
              isOpenAccess: c.isOpenAccess,
              oaEvidence: c.oaEvidence,
            });
            return {
              paperId: c.paperId,
              title: c.title,
              doi: c.doi,
              sourceName: c.sourceName,
              sourceUrl: c.sourceUrl,
              pdfUrl: c.pdfUrl,
              license: c.license,
              isOpenAccess: c.isOpenAccess,
              oaEvidence: c.oaEvidence,
              downloadedPath: c.downloadedPath,
              downloadedAt: c.downloadedAt,
              sha256: c.sha256,
              fileSizeBytes: c.fileSizeBytes,
              serveInApp: policy.serveInApp,
              allowUserDownload: policy.allowUserDownload,
              policyReason: policy.policyReason,
              policyVersion: policy.policyVersion,
              textExtractionStatus: "not_started",
              pdfTextPath: null,
            };
          }),
      ],
    };
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  if (!dryRun) {
    const scanStatus = {
      generatedAt: nowIso(),
      command: "discover:oa-pdfs",
      isTestOutput: true,
      dryRun,
      schedulerInstalled: false,
      limit,
      downloadLimit,
      candidatesFound: report.candidatesFound,
      acceptedCount: report.acceptedCount,
      reviewCount: report.reviewCount,
      rejectedCount: report.rejectedCount,
      downloadedCount,
    };
    await fs.mkdir(path.dirname(scanStatusPath), { recursive: true });
    await fs.writeFile(scanStatusPath, `${JSON.stringify(scanStatus, null, 2)}\n`);
  }

  return report;
}

function parseArgs(argv) {
  const args = {
    limit: DEFAULT_LIMIT,
    downloadLimit: DEFAULT_DOWNLOAD_LIMIT,
    dryRunExplicit: false,
    writeStaging: false,
    download: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") args.dryRunExplicit = true;
    else if (arg === "--write-staging") args.writeStaging = true;
    else if (arg === "--download") args.download = true;
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--download-limit") args.downloadLimit = Number(argv[++i]);
    else if (arg.startsWith("--download-limit=")) args.downloadLimit = Number(arg.slice("--download-limit=".length));
    else if (arg === "--source") args.source = argv[++i];
    else if (arg.startsWith("--source=")) args.source = arg.slice("--source=".length);
    else if (arg === "--topic") args.topic = argv[++i];
    else if (arg.startsWith("--topic=")) args.topic = arg.slice("--topic=".length);
    else if (arg === "--country") args.country = argv[++i];
    else if (arg.startsWith("--country=")) args.country = arg.slice("--country=".length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await discoverOpenAccessPdfs(args);

  console.log("\n" + "=".repeat(60));
  console.log("Open-Access PDF Discovery Summary");
  console.log("=".repeat(60));
  console.log(`Mode:                 ${result.dryRun ? "DRY RUN (no writes, no downloads)" : "live"}`);
  console.log(`Source filter:        ${result.sourceFilter || "(all enabled sources)"}`);
  console.log(`Topic filter:         ${result.topicFilter || "(full topic list)"}`);
  console.log(`Country filter:       ${result.countryFilter || "(none)"}`);
  console.log(`Candidates found:     ${result.candidatesFound}`);
  console.log(`  Accepted:           ${result.acceptedCount}`);
  console.log(`  Needs review:       ${result.reviewCount}`);
  console.log(`  Rejected:           ${result.rejectedCount}`);
  console.log(`Downloaded this run:  ${result.downloadedCount}`);
  if (!result.dryRun && result.writeStagingRequested) {
    console.log(`Staging output:       ${path.relative(rootDir, stagingPath)}`);
  }
  if (result.downloadedCount > 0) {
    console.log(`PDF storage:          ${path.relative(rootDir, pdfDir)}`);
    console.log(`Manifest:             ${path.relative(rootDir, manifestPath)}`);
  }
  console.log("=".repeat(60) + "\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error("Fatal error during discover:oa-pdfs:", error);
    process.exitCode = 1;
  });
}
