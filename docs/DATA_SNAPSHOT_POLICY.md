# Data Snapshot Policy

This repo mixes source code with generated data. Without a clear rule,
running an ingestion script locally (`process:records`, `enrich:images`,
`discover:official-sources`, etc.) leaves `data/processed/*.json` modified,
and those changes silently ride along into an unrelated code PR. This
document defines what belongs in a normal code PR versus a deliberate data
update, and `scripts/ingestion/verifyGitCleanForPr.mjs` (`npm.cmd run
verify:git-clean-for-pr`) enforces it before a PR is opened.

## The four categories

### 1. Source code / config / docs

- `scripts/`
- `src/`
- `package.json`, `package-lock.json`
- `docs/`
- `.github/`
- `deploy/`

This is the only thing a normal code PR should contain. It is authored by
hand, reviewed line by line, and never produced by running a pipeline
script.

### 2. Test fixtures

- `data/test/`

Small, hand-authored (or deliberately generated once and reviewed) input
files used by verification scripts (e.g.
`data/test/incoming-records-sample.json` for
`verify:incremental-comparison`). These are committed intentionally, as
part of writing or updating a test, not as a side effect of running the
real pipeline. A code PR may touch `data/test/` when it is adding or
updating a fixture for the code change it contains.

### 3. Runtime / generated data

- `data/processed/*.json`
- `data/raw/`
- `data/logs/`
- `dist/`
- `build/`

These are produced by running scripts (`process:records`, `enrich:images`,
`discover:official-sources`, `npm.cmd run build`, ...). They are
regenerated from source data plus code, are not hand-authored, and change
on every run even when nothing meaningful changed (timestamps, re-ordering,
etc. - see the idempotent-write handling in `compareRecords.mjs` for the
lengths already gone to in order to reduce this noise). A normal code PR
must never contain these.

### 4. Stable app data snapshots

`data/processed/*.json` is also, separately, the file set the deployed app
actually reads from (see `src/data/researchGalleryData.js` ->
`display-records.json`). Updating that live snapshot is a real,
user-visible change - just not a code change - and is only ever committed
through the dedicated flow described below, never bundled into a code PR.

## Two PR types

### A. Code PR

- Contains only category 1 (and, when a test needs it, category 2) files.
- Must **not** contain category 3 files, and must not contain a category 4
  snapshot update.
- Before opening: run `npm.cmd run verify:git-clean-for-pr`. If it reports
  blocked files, restore/clean them (see "Remediation" below) rather than
  committing them.

### B. Data snapshot PR

- Explicitly named as a data update (e.g. "Refresh data/processed snapshot
  - N records re-verified"), never mixed into a code change's title or
  description.
- Allowed to contain `data/processed/*.json`.
- Must include, in the PR description, what generated it (which
  command(s), with what flags/limits) and the verification command
  output that confirms the new snapshot is valid (e.g.
  `verify:display-eligibility`, `verify:image-enrichment`,
  `verify:source-discovery` results).
- Must be manually reviewed before merge - a generated-data diff is not
  self-evidently correct just because a script produced it.
- Run `npm.cmd run verify:git-clean-for-pr -- --allow-data-snapshot` to
  confirm nothing OTHER than the intended data files (no `.env`,
  `node_modules`, `dist`, `build`, `.zip`, `data/raw`, `data/logs`) is
  present.

## Remediation

**For a code PR** that picked up generated data accidentally:

```bash
git restore data/processed
git clean -f data/processed/*.json
```

(adjust paths to whatever `verify:git-clean-for-pr` reported), then commit
only the source code/config/docs files.

**For an intentional data snapshot PR**:

```bash
npm.cmd run verify:git-clean-for-pr -- --allow-data-snapshot
```

and include the verification/provenance output in the PR description.

## Scope note

This policy step does not remove any existing committed `data/processed/*.json`
files and does not change what the frontend reads from. It only documents
the rule and adds a command that checks a PR against it.
