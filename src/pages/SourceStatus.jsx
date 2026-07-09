import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clock3, Database, RefreshCw, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import {
  extractionRuns,
  liveResearchMeta,
  liveResearchSources,
} from "../data/researchProjectData.js";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

const idleRefreshState = {
  status: "idle",
  progress: 0,
  currentSource: "",
  completedSources: [],
  startedAt: null,
  completedAt: null,
  message: "Manual extraction has not started.",
  logs: [],
};

function formatDateTime(value) {
  if (!value) {
    return "Not recorded";
  }

  return new Date(value).toLocaleString();
}

function normaliseRefreshState(payload) {
  return {
    ...idleRefreshState,
    ...payload,
    progress: Math.min(100, Math.max(0, Number(payload?.progress ?? 0))),
    completedSources: Array.isArray(payload?.completedSources)
      ? payload.completedSources
      : [],
    logs: Array.isArray(payload?.logs) ? payload.logs : [],
  };
}

export default function SourceStatus() {
  const [refreshState, setRefreshState] = useState(idleRefreshState);
  const [refreshError, setRefreshError] = useState("");

  const refreshMinutes = Math.round(
    (liveResearchMeta.testingRefreshIntervalMs ?? 0) / 60000
  );
  const isRunning = refreshState.status === "running";
  const latestLogs = useMemo(
    () => refreshState.logs.slice(-8).reverse(),
    [refreshState.logs]
  );

  const fetchRefreshStatus = useCallback(async () => {
    const response = await fetch(`${API_BASE_URL}/api/extraction/status`);
    if (!response.ok) {
      throw new Error(`Status check failed (${response.status})`);
    }
    const payload = await response.json();
    setRefreshState(normaliseRefreshState(payload));
    return payload;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadStatus = async () => {
      try {
        await fetchRefreshStatus();
        if (!cancelled) {
          setRefreshError("");
        }
      } catch (error) {
        if (!cancelled) {
          setRefreshError(error.message);
        }
      }
    };

    loadStatus();

    return () => {
      cancelled = true;
    };
  }, [fetchRefreshStatus]);

  useEffect(() => {
    if (!isRunning) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      fetchRefreshStatus().catch((error) => setRefreshError(error.message));
    }, 1200);

    return () => window.clearInterval(intervalId);
  }, [fetchRefreshStatus, isRunning]);

  async function handleManualRefresh() {
    setRefreshError("");
    setRefreshState((current) => ({
      ...current,
      status: "running",
      progress: Math.max(current.progress, 2),
      message: "Starting online extraction...",
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/api/extraction/run`, {
        method: "POST",
      });
      const payload = await response.json();
      setRefreshState(normaliseRefreshState(payload));

      if (!response.ok && response.status !== 409) {
        throw new Error(payload?.error ?? `Refresh failed (${response.status})`);
      }
    } catch (error) {
      setRefreshError(error.message);
      setRefreshState((current) => ({
        ...current,
        status: current.status === "running" ? "failed" : current.status,
        message: "Could not start extraction.",
      }));
    }
  }

  return (
    <main className="detail-shell source-status-shell">
      <div className="ocean-grid" aria-hidden="true" />

      <section className="detail-hero">
        <Link className="back-link" to="/">
          <ArrowLeft size={18} />
          Back to map
        </Link>
        <p className="eyebrow">Source monitoring</p>
        <h1>Maritime R&D Data Status</h1>
        <p>{liveResearchMeta.statusMessage}</p>
        <div className="source-status-kpis">
          <span>
            <RefreshCw size={17} />
            Test refresh: {refreshMinutes} minutes
          </span>
          <span>
            <Database size={17} />
            {liveResearchSources.length} evidence sources
          </span>
          <span>
            <Clock3 size={17} />
            Last sync: {formatDateTime(liveResearchMeta.lastSuccessfulSync)}
          </span>
        </div>
      </section>

      <section className="source-status-grid">
        <article className="detail-card wide refresh-control-card">
          <div className="refresh-control-header">
            <div>
              <p className="eyebrow">Manual online extraction</p>
              <h2>
                <RefreshCw size={20} />
                Refresh Data
              </h2>
            </div>
            <button
              className="refresh-run-button"
              disabled={isRunning}
              type="button"
              onClick={handleManualRefresh}
            >
              <RefreshCw size={17} className={isRunning ? "spin" : ""} />
              {isRunning ? "Extracting" : "Refresh"}
            </button>
          </div>

          <div className="refresh-progress-row">
            <div
              className="refresh-progress-track"
              aria-label="Extraction progress"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={refreshState.progress}
              role="progressbar"
            >
              <i style={{ width: `${refreshState.progress}%` }} />
            </div>
            <strong>{refreshState.progress}%</strong>
          </div>

          <div className="refresh-progress-meta">
            <span>Status: {refreshState.status}</span>
            <span>Current: {refreshState.currentSource || "Waiting"}</span>
            <span>
              Completed: {refreshState.completedSources.length} /{" "}
              {refreshState.totalSources ?? 4}
            </span>
            <span>Started: {formatDateTime(refreshState.startedAt)}</span>
          </div>

          <p className="refresh-message">{refreshState.message}</p>
          {refreshError ? <p className="refresh-error">{refreshError}</p> : null}

          {latestLogs.length ? (
            <div className="refresh-log-list" aria-label="Latest extraction logs">
              {latestLogs.map((line, index) => (
                <code key={`${line}-${index}`}>{line}</code>
              ))}
            </div>
          ) : null}

          {refreshState.status === "completed" ? (
            <button
              className="refresh-secondary-button"
              type="button"
              onClick={() => window.location.reload()}
            >
              Reload page to view latest generated data
            </button>
          ) : null}
        </article>

        <article className="detail-card wide">
          <h2>
            <ShieldCheck size={20} />
            Configured Source Health
          </h2>
          <div className="source-monitor-grid">
            {liveResearchMeta.sourceStatus.map((source) => (
              <article className="source-monitor-card" key={source.sourceId}>
                <p className="eyebrow">{source.extractionType}</p>
                <h3>{source.sourceName}</h3>
                <dl className="relationship-meta">
                  <div>
                    <dt>Status</dt>
                    <dd>{source.lastSuccessfulSync ? "success" : "failed"}</dd>
                  </div>
                  <div>
                    <dt>Fetched</dt>
                    <dd>{source.recordsFetched}</dd>
                  </div>
                  <div>
                    <dt>Rejected</dt>
                    <dd>{source.recordsRejected}</dd>
                  </div>
                  <div>
                    <dt>Next run</dt>
                    <dd>{formatDateTime(source.nextScheduledRun)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </article>

        <article className="detail-card wide">
          <h2>Latest Extraction Runs</h2>
          <div className="extraction-run-list">
            {extractionRuns.map((run) => (
              <article className="extraction-run-card" key={run.id}>
                <strong>{run.sourceName}</strong>
                <span>{run.extractionMethod}</span>
                <b>{run.status}</b>
                <small>
                  {run.recordsFetched} fetched / {run.recordsCreated} created /{" "}
                  {run.recordsRejected} rejected
                </small>
              </article>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
