# SMI Project

An interactive maritime R&D intelligence map prototype for discovering, explaining and verifying global maritime research activity.

The current version is a frontend MVP built with React and Vite. It renders a dark ocean-style rotatable globe, clickable research countries and project markers, evidence-backed project pages, topic views, and a local source-status page.

## Features

- Interactive rotatable maritime research globe
- Country and project marker popups
- Research-intensity country coloring
- Evidence-based project detail pages
- Explainable country-institution-project relationships
- Source status page at `/sources/status`
- Local generated data file consumed by the frontend
- Local extraction scripts for refreshed public maritime R&D records
- Test refresh mode with 5-minute intervals

## Tech Stack

- React
- Vite
- D3 Geo
- TopoJSON
- Framer Motion
- Lucide React
- Vitest

## Getting Started

Install dependencies:

```bash
npm install
```

Generate or refresh local research data:

```bash
npm run sync:data
```

Run the development server:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Build for production:

```bash
npm run build
```

## Data Refresh

The app is still frontend-only. The extraction scripts write generated data to:

```text
src/data/generated/liveResearchData.json
```

For local testing, run the extractor every 5 minutes:

```bash
npm run sync:watch
```

The generated dataset includes projects, countries, institutions, sources, extraction runs and explainable relationship records.

## Project Structure

```text
src/
  components/
  data/
  pages/
  utils/
scripts/
  ingestion/
```

## Notes

This MVP does not include a backend, database, login, admin system, upload flow or production security layer yet. Those can be added in a later version when the data model and user workflows are stable.

---
*Last updated: 2026-07-20 — auto-push enabled*
