# Image Fetching Cloud Runbook (AWS Lightsail)

## Why run this on the server at all

Both `fetch:country-flags` and `discover:institution-images:sample` make
real outbound HTTP requests to external domains (flagcdn.com, and each
sample institution's own homepage). If the local development machine has
restricted or unreliable outbound internet access, these scripts can be
run unchanged on the Lightsail server instead, as long as it has outbound
access - nothing in either script is local-machine-specific.

## Prerequisites

- Same Node version as local development (see `package.json`'s engines,
  or whatever the deployed environment already uses).
- Outbound HTTPS access from the server to the target domains (flagcdn.com
  and each sample institution's own site). No inbound access is needed for
  this task.
- No AI API key required - the mock evaluator (Part D) needs none.

## Commands

```bash
cd /opt/maritime-research
npm run build:country-registry
npm run fetch:country-flags -- --all --missing-only
npm run build:institution-registry
npm run discover:institution-images -- --missing-only --limit 20
npm run discover:research:global -- --dry-run --limit 20
npm run verify:country-flags
npm run verify:institution-registry
npm run verify:institution-images-in-ui
npm run verify:research-discovery
npm run verify:image-propagation
npm run build
```

The first four commands (registry builds, flag fetch, institution image
discovery) are safe to run for real - each writes to its own bounded
output and never touches production research data. `discover:research:
global` is shown with `--dry-run` here deliberately - drop it only after
reviewing a dry-run's candidate list, since promoting a candidate into
the real pipeline is a separate, manual step (see
docs/GLOBAL_DATA_AND_IMAGE_EXPANSION_PLAN.md).

Add `-- --dry-run` to `discover:institution-images:sample` to check
candidates and mock-evaluator verdicts without downloading anything first:

```bash
npm run discover:institution-images:sample -- --dry-run
```

## Safety notes for running on the server

- **No API keys in Git.** Neither script needs one today (mock evaluator
  only). If/when the real AI API replaces the mock evaluator, its key goes
  in the server's own `.env` (see `docs/API_KEYS_AND_MANUAL_REFRESH.md`),
  never committed.
- **Downloads stay small and bounded.** Max 2MB per image, max 1 accepted
  image per institution, max 20 institutions per run, 15s timeout per
  request - see `scripts/ingestion/discoverInstitutionImagesSample.mjs`'s
  safety-limit constants. A run against the full sample list downloads at
  most a few hundred KB total.
- **Do not expand to all institutions yet.** The sample list
  (`SAMPLE_INSTITUTIONS` in `discoverInstitutionImagesSample.mjs`) is
  explicit and small on purpose - this is a feasibility test, not the
  117-country/full-institution rollout (that is a separate, later task).
- **No scheduler.** Run these commands manually when needed; nothing here
  installs a cron job or systemd timer.
- **Generated output stays out of git by default.** The registry/report
  JSON files this produces live under `data/processed/test/` (gitignored -
  see `docs/DATA_SNAPSHOT_POLICY.md`); only the actual asset files
  (`public/assets/flags/*.svg`, `public/assets/test/institutions/**`) are
  meant to be reviewed and, if approved, committed as a deliberate data
  snapshot - never automatically.

## Manual promotion workflow (institution images -> production UI)

Discovery output is never wired directly into the UI - promoting an
accepted image is always a deliberate, reviewed step:

1. Run sample discovery: `npm run discover:institution-images:sample`
   (add `-- --dry-run` first to review candidates without downloading).
2. Review the accepted entries in
   `data/processed/test/institution-image-sample.json` - confirm the
   source page, `mockAiScore`, and `mockAiReason` actually look right for
   that institution.
3. Copy the approved asset(s) from `public/assets/test/institutions/{slug}/`
   to `public/assets/institutions/{slug}/`.
4. Add the corresponding entry to `src/data/institutionImageRegistry.js`
   (copied verbatim from the accepted record, never invented).
5. Run `npm run verify:institution-images-in-ui` and
   `npm run verify:country-flags`.
6. Run `npm run build`.
7. Deploy the built `dist/` output as usual - `public/assets/institutions/`
   and `public/assets/flags/` are static assets Vite copies straight into
   the build; no server-side code path needed for either.

## If local internet access fails

If `fetch:country-flags` or `discover:institution-images:sample` fail
locally with network/timeout errors but the code itself is correct (check
`npm run verify:image-propagation`, which needs no network), that is very
likely a local connectivity restriction, not a bug. Push the branch, then
run the same two commands on the Lightsail box instead - the scripts are
already server-portable (relative paths, no local-machine assumptions,
mock evaluator needs no key).
