/**
 * Maritime R&D Intelligence Platform — backend API (Phase 2 bootstrap).
 *
 * Zero-dependency Node HTTP server exposing the target endpoints over the
 * generated dataset (src/data/generated/liveResearchData.json). The file is
 * re-read when its mtime changes, so a cron-driven `npm run sync:data` on
 * the server refreshes the API without a restart or rebuild.
 *
 * Endpoints:
 *   GET  /api/health
 *   GET  /api/projects
 *   GET  /api/projects/:id            (accepts project id or slug)
 *   GET  /api/countries
 *   GET  /api/countries/:countryCode  (ISO code or country slug)
 *   GET  /api/topics
 *   GET  /api/topics/:slug
 *   GET  /api/search?q=
 *   POST /api/projects/:id/analyse    (501 stub — AI analysis is Phase 3)
 *
 * Configuration via environment variables only (no secrets in code):
 *   API_PORT  (default 8787)
 *   API_HOST  (default 127.0.0.1; set 0.0.0.0 behind nginx on Lightsail)
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(
  __dirname,
  "../src/data/generated/liveResearchData.json"
);

const PORT = Number(process.env.API_PORT ?? 8787);
const HOST = process.env.API_HOST ?? "127.0.0.1";

// Mirrors src/data/researchProjectData.js topicToProjectCategories.
// Kept server-side so the API has no build-time coupling to frontend code.
const TOPICS = [
  { slug: "green-shipping", name: "Green Shipping", categories: ["Alternative energy and fuels", "Vessel efficiency", "Carbon capture"] },
  { slug: "smart-ports", name: "Smart Ports", categories: ["Autonomous port operations", "Intelligent port services", "Digital twins", "Port automation", "Supply-chain and logistics"] },
  { slug: "autonomous-vessels", name: "Autonomous Vessels", categories: ["Autonomous navigation", "Smart ships"] },
  { slug: "maritime-ai", name: "Maritime AI", categories: ["Artificial intelligence", "Digital twins"] },
  { slug: "alternative-fuels", name: "Alternative Fuels", categories: ["Alternative energy and fuels", "Carbon capture"] },
  { slug: "maritime-cybersecurity", name: "Maritime Cybersecurity", categories: ["Maritime cybersecurity", "Safety and risk management"] },
];

// ---------------------------------------------------------------------------
// Dataset loading with mtime-based refresh (no restart needed after sync).
// ---------------------------------------------------------------------------
let cachedDataset = null;
let cachedMtimeMs = 0;

function loadDataset() {
  const stats = fs.statSync(DATA_PATH);
  if (!cachedDataset || stats.mtimeMs !== cachedMtimeMs) {
    cachedDataset = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
    cachedMtimeMs = stats.mtimeMs;
    console.log(
      `[api] dataset loaded: ${cachedDataset.publicProjects?.length ?? 0} projects, ` +
        `${cachedDataset.countries?.length ?? 0} countries (generatedAt ${cachedDataset.meta?.generatedAt})`
    );
  }
  return cachedDataset;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    // Internal platform MVP: permissive CORS so the Vite dev server can call
    // the API. Lock this down to the deployed origin in Phase 4.
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function notFound(res, message = "Not found") {
  sendJson(res, 404, { error: message });
}

function findProject(dataset, idOrSlug) {
  const needle = decodeURIComponent(idOrSlug);
  return (
    dataset.projects?.find(
      (project) => project.id === needle || project.slug === needle
    ) ?? null
  );
}

function projectMatchesTopic(project, topic) {
  const categories = project.researchCategories ?? project.categories ?? [];
  return categories.some((category) => topic.categories.includes(category));
}

function searchProjects(dataset, query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return (dataset.publicProjects ?? []).filter((project) => {
    const haystack = [
      project.title,
      project.summary,
      project.country,
      project.leadOrganisation,
      ...(project.researchCategories ?? []),
      ...(project.technologies ?? []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(q);
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  const segments = url.pathname.split("/").filter(Boolean); // e.g. ["api","projects","x"]

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (segments[0] !== "api") {
    notFound(res, "API routes live under /api");
    return;
  }

  let dataset;
  try {
    dataset = loadDataset();
  } catch (error) {
    sendJson(res, 503, {
      error: "Dataset unavailable. Run `npm run sync:data` first.",
      detail: error.message,
    });
    return;
  }

  const [, resource, identifier, action] = segments;

  // GET /api/health
  if (req.method === "GET" && resource === "health" && !identifier) {
    sendJson(res, 200, {
      status: "ok",
      datasetGeneratedAt: dataset.meta?.generatedAt ?? null,
      lastSuccessfulSync: dataset.meta?.lastSuccessfulSync ?? null,
      publicProjects: dataset.publicProjects?.length ?? 0,
      countries: dataset.countries?.length ?? 0,
      sources: dataset.meta?.sourceStatus?.map((source) => ({
        sourceId: source.sourceId,
        lastSuccessfulSync: source.lastSuccessfulSync || null,
        parseErrors: source.parseErrors?.length ?? 0,
      })) ?? [],
    });
    return;
  }

  // /api/projects...
  if (resource === "projects") {
    // POST /api/projects/:id/analyse — Phase 3 stub
    if (req.method === "POST" && identifier && action === "analyse") {
      const project = findProject(dataset, identifier);
      if (!project) {
        notFound(res, `No project with id or slug "${identifier}"`);
        return;
      }
      sendJson(res, 501, {
        error: "AI analysis is not implemented yet (goal tracker item 9, Phase 3).",
        projectId: project.id,
        plannedFields: [
          "summary", "topics", "technology", "developmentStage", "importance",
          "relevanceToSMI", "relevanceScore", "collaborationPotential", "risks", "evidence",
        ],
      });
      return;
    }

    if (req.method === "GET" && identifier) {
      const project = findProject(dataset, identifier);
      if (!project) {
        notFound(res, `No project with id or slug "${identifier}"`);
        return;
      }
      const relationships = (dataset.relationships ?? []).filter(
        (rel) => rel.targetEntityId === project.id || rel.sourceEntityId === project.id
      );
      sendJson(res, 200, { project, relationships });
      return;
    }

    if (req.method === "GET") {
      sendJson(res, 200, {
        count: dataset.publicProjects?.length ?? 0,
        projects: dataset.publicProjects ?? [],
      });
      return;
    }
  }

  // /api/countries...
  if (resource === "countries" && req.method === "GET") {
    if (identifier) {
      const needle = decodeURIComponent(identifier).toLowerCase();
      const country = (dataset.countries ?? []).find(
        (item) =>
          item.code?.toLowerCase() === needle || item.slug?.toLowerCase() === needle
      );
      if (!country) {
        notFound(res, `No country with code or slug "${identifier}"`);
        return;
      }
      const projects = (dataset.publicProjects ?? []).filter(
        (project) => project.countryCode === country.code
      );
      sendJson(res, 200, { country, projects });
      return;
    }
    sendJson(res, 200, {
      count: dataset.countries?.length ?? 0,
      countries: dataset.countries ?? [],
    });
    return;
  }

  // /api/topics...
  if (resource === "topics" && req.method === "GET") {
    if (identifier) {
      const topic = TOPICS.find((item) => item.slug === identifier);
      if (!topic) {
        notFound(res, `No topic with slug "${identifier}"`);
        return;
      }
      const projects = (dataset.publicProjects ?? []).filter((project) =>
        projectMatchesTopic(project, topic)
      );
      sendJson(res, 200, { topic, count: projects.length, projects });
      return;
    }
    sendJson(res, 200, {
      topics: TOPICS.map((topic) => ({
        ...topic,
        projectCount: (dataset.publicProjects ?? []).filter((project) =>
          projectMatchesTopic(project, topic)
        ).length,
      })),
    });
    return;
  }

  // GET /api/search?q=
  if (resource === "search" && req.method === "GET") {
    const query = url.searchParams.get("q") ?? "";
    const results = searchProjects(dataset, query);
    sendJson(res, 200, { query, count: results.length, results });
    return;
  }

  notFound(res);
}

const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (error) {
    console.error("[api] unhandled error:", error);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[api] Maritime R&D API listening on http://${HOST}:${PORT}/api/health`);
});
