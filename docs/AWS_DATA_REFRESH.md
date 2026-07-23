# AWS server-side data refresh

How the app automatically fetches real maritime R&D data on the Lightsail
server, independent of code deploys.

## Architecture in one paragraph

The React frontend never calls OpenAlex/Crossref/CORDIS/any AI API
directly. A pipeline of Node scripts under `scripts/ingestion/` runs on the
**server**, fetches from public APIs, saves the raw responses, and produces
processed JSON files under `data/processed/`. `server/server.mjs` (the
existing backend API) serves those files over HTTP. A systemd timer runs
the whole pipeline once a day. This is completely separate from the
existing GitHub Actions deploy pipeline (`.github/workflows/deploy.yml`),
which only ships *code* changes — the timer refreshes *data*, on its own
clock, whether or not anyone has pushed a commit that day.

```
OpenAlex API
  -> data/raw/openalex/<run-id>.json          (fetch:openalex)
  -> data/processed/research-records.json     (process:records)
  -> data/processed/country-profiles.json     (build:country-profiles)
  -> data/processed/update-status.json        (refresh:data, on success only)
  -> server/server.mjs  ->  GET /api/research-records, /api/country-profiles
```

## 1. Manual refresh on AWS

SSH into the box, then:

```bash
cd /opt/maritime-research
npm run refresh:data
```

(On Windows for local development, use `npm.cmd run refresh:data` instead.)

This runs the full chain: `fetch:openalex` → `process:records` →
`build:country-profiles` → `verify:data-provenance`. New output is built
in a temp directory and only swapped into `data/processed/` if
verification passes — a bad fetch never overwrites good data. On failure,
the previous processed files and `update-status.json` are left untouched
except for `lastAttemptedFetchAt` and `status: "failed"`.

You can also trigger a refresh remotely via the admin API (see §7).

## 2. Checking logs

```bash
tail -n 100 data/logs/data-refresh.log
```

Every run (manual or scheduled) appends a timestamped block here,
regardless of success or failure. Also check systemd's own journal for the
scheduled runs:

```bash
journalctl -u maritime-data-refresh.service -n 100 --no-pager
```

## 3. Checking update status

```bash
cat data/processed/update-status.json
```

Or via the API: `curl http://127.0.0.1/api/data/update-status`. Fields:
`lastSuccessfulFetchAt`, `lastAttemptedFetchAt`, `recordsFetched`,
`recordsProcessed`, `recordsAdded`, `recordsUpdated`, `duplicatesSkipped`,
`status` (`success` | `failed`), `errors`.

## 4. Installing/enabling the scheduler

**This is self-installing** — every deploy via `.github/workflows/deploy.yml`
copies `deploy/systemd/maritime-data-refresh.{service,timer}` into
`/etc/systemd/system/`, reloads systemd, and runs
`systemctl enable --now maritime-data-refresh.timer`. Nothing to do after
the first successful deploy following this change.

To install manually (e.g. on a box that hasn't deployed yet, or to verify):

```bash
sudo cp deploy/systemd/maritime-data-refresh.service /etc/systemd/system/
sudo cp deploy/systemd/maritime-data-refresh.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now maritime-data-refresh.timer
```

The timer fires once daily at 03:17 UTC (deliberately off-peak and off the
hour), with `Persistent=true` so a missed run (box was rebooting) fires
once on next boot instead of silently skipping a day.

Check it's active:

```bash
systemctl status maritime-data-refresh.timer
systemctl list-timers maritime-data-refresh.timer
```

Run it once immediately, outside its schedule, to test:

```bash
sudo systemctl start maritime-data-refresh.service
```

### Required environment file

The service reads `/opt/maritime-research/.env` (never committed to git —
covered by `.gitignore`). Create it once on the server:

```bash
sudo tee /opt/maritime-research/.env >/dev/null <<'EOF'
OPENALEX_EMAIL=it@maritimeinstitute.sg
ADMIN_TOKEN=<generate a random string - e.g. `openssl rand -hex 24`>
EOF
sudo chmod 600 /opt/maritime-research/.env
```

`docker compose` also reads this same `.env` file (via `${OPENALEX_EMAIL:-}`
and `${ADMIN_TOKEN:-}` in `compose.yaml`) so the `api` container picks up
the same values — restart it after creating/changing the file:
`sudo docker compose up -d`.

## 5. Disabling the scheduler

```bash
sudo systemctl disable --now maritime-data-refresh.timer
```

Re-enabling: repeat the install commands in §4, or just re-deploy (it's
self-installing).

## 6. How the frontend/API receives updated data

- The `api` Docker container bind-mounts the host's `data/` directory
  (`./data:/app/data` in `compose.yaml`), so `server/server.mjs` sees new
  `data/processed/*.json` files the moment the timer (running on the host,
  outside Docker) writes them — **no container rebuild or restart needed**.
  `server.mjs` caches each processed file by mtime, exactly like it already
  does for the legacy dataset.
- New endpoints: `GET /api/data/update-status`, `GET /api/research-records`
  (supports `?limit=&offset=`), `GET /api/country-profiles`.
- **Important limitation, stated plainly**: the React app itself still gets
  its data via a **build-time static import** of the older, separate
  `src/data/generated/liveResearchData.json` (see
  `src/data/researchProjectData.js`) — it does not yet call these new
  endpoints. Wiring the UI to consume `/api/research-records` and
  `/api/country-profiles` at runtime is a frontend change, deliberately out
  of scope for this pass (the task that produced this pipeline was
  explicit: "do not focus on UI first"). Until that follow-up lands, the
  new pipeline's data is real, fetched, verified, and API-accessible, but
  not yet what map visitors see - only what `curl`/an admin/a future
  frontend change would see.

## 7. Admin-triggered refresh via HTTP

`POST /api/admin/refresh-data` is **disabled by default** — it 404s unless
`ADMIN_TOKEN` is set in the server's environment. Once set:

```bash
curl -X POST http://127.0.0.1/api/admin/refresh-data \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Returns `202 Accepted` immediately (a full refresh can take minutes — well
past typical reverse-proxy timeouts) and runs in the background; poll
`GET /api/data/update-status` for the result. Returns `409` if a refresh is
already running, `401` if the token doesn't match, `404` if no
`ADMIN_TOKEN` is configured at all.

## 8. Where raw and processed files live

```
data/raw/openalex/<run-id>.json    one file per fetch run, gitignored
                                    (persisted on the server's data/ volume,
                                    not in git - see .gitignore)
data/processed/research-records.json    committed to git after each
data/processed/country-profiles.json    meaningful local run, same
data/processed/update-status.json       convention as src/data/generated/
data/logs/data-refresh.log         append-only, gitignored
```

`data/processed/research-records.json` also carries forward any records
from the separate `npm run ingest:media-seed` pipeline (CORDIS records,
`dataOrigin: "manual_seed"`) — `process:records` merges rather than
overwrites, so re-running the OpenAlex refresh never deletes that data.

## Data sources and scope (current phase)

- **Phase 1 (implemented)**: OpenAlex Works API — the only live fetch
  source right now.
- **Crossref**: used only for secondary DOI verification of records
  OpenAlex already found (adds a confirmed source URL), not as an
  independent discovery source — same pattern the older `sync:data`
  pipeline already used.
- **Phase 3 (not built)**: CORDIS/OpenAIRE project data. No adapter exists
  yet for this pipeline; `npm run ingest:media-seed` (a separate, one-off
  script) already carries a small set of real CORDIS records forward, but
  there is no automated CORDIS *fetcher*. Flagged here rather than faked.

Raw collection window: `2015-01-01` to present (nothing older is fetched
at all). Default display/scoring window: `2020-01-01` to present. Latest
highlight window: `2024-01-01` to present. These are recency-scoring
concerns for the (future) frontend integration, not fetch-time filters —
narrowing the fetch itself to 2020+ would permanently discard real
2015-2019 records the raw window is meant to keep.
