# SMI Project — Global Maritime Research Intelligence Map

An internal maritime R&D intelligence platform for SMI staff to explore
global maritime research on an interactive globe — projects by country,
institution, topic and stage — with AI analysis added only after
extraction (planned, not yet built).

## Current state

- **Frontend**: React 18 + Vite 6 dashboard is functional — rotatable
  globe, country/project popups, topic pages, source-status page.
- **Data**: static generated JSON (`src/data/generated/liveResearchData.json`),
  built by Node ingestion scripts. Currently a small prototype dataset;
  target is 500 real records (see goal tracker in `CLAUDE.md`).
- **Backend**: a lightweight Node HTTP API (`server/server.mjs`) exists
  and exposes `/api/health`, `/api/projects`, `/api/countries`,
  `/api/topics`, `/api/search`, etc., reading the same generated JSON.
  The frontend does not consume it yet — it still imports the data file
  directly at build time.
- **AI analysis layer**: not built yet (Phase 3).
- **Deployment**: no Lightsail deployment config yet (Phase 4).

See `CLAUDE.md` for the full architecture rules and goal tracker.

## Features

- Interactive rotatable maritime research globe (50m atlas, back-face
  culling, dual-LOD path caching for performance)
- Country and project marker popups, country profile panel
- Research-intensity country coloring (blue/cyan/teal; red = selection)
- Evidence-based project detail pages with source links
- Topic pages: green shipping, smart ports, autonomous vessels,
  maritime AI, alternative fuels, maritime cybersecurity
- Source status page at `/sources/status`
- Route-level code splitting for detail pages

## Tech stack

- React 18, React Router
- Vite 6
- d3-geo, topojson-client/simplify, world-atlas (50m)
- Framer Motion, Lucide React
- Vitest
- Node (zero-dependency) HTTP server for the backend API

## Getting started

Install dependencies:

```bash
npm.cmd install
```

Run the dev server:

```bash
npm.cmd run dev
```

Run tests:

```bash
npm.cmd test -- --run
```

Production build:

```bash
npm.cmd run build
```

## Data ingestion

Ingestion scripts (`scripts/ingestion/`, Node `.mjs`) pull from public
APIs/RSS only — no AI fetching of webpages. Every real record includes a
source URL and fetched timestamp; one failed source never stops the rest
of the pipeline.

Run once:

```bash
npm.cmd run sync:data
```

Run on a watch interval:

```bash
npm.cmd run sync:watch
```

Output goes to `src/data/generated/liveResearchData.json`, consumed by
the frontend at build time.

## Backend API (bootstrap, Phase 2)

```bash
npm.cmd run serve:api
```

Reads the same generated dataset, refreshing automatically when its
mtime changes (no restart needed after a re-sync). Configure via
`API_PORT` / `API_HOST` environment variables — no secrets in code.

## Project structure

```text
src/
  components/       UI components (globe, popups, cards, panels)
  pages/            Route-level pages (country, project, topic, sources)
  data/             Static + generated research data, topic/source config
  utils/            Intensity scoring, URL helpers
scripts/
  ingestion/        Extraction adapters (OpenAlex, Crossref, ROR, MPA) + pipeline
server/
  server.mjs        Backend API bootstrap over the generated dataset
```

## Routes

`/`, `/country/:slug`, `/projects/:projectSlug`, `/sources/status`,
`/topic/green-shipping`, `/topic/smart-ports`, `/topic/autonomous-vessels`,
`/topic/maritime-ai`, `/topic/alternative-fuels`,
`/topic/maritime-cybersecurity`

## Notes

Mock/prototype data stays labelled "Prototype demo data - source
verification pending" until replaced by real ingested records. No
database, login, admin system or production security layer yet — those
land after the data model and API are stable.
