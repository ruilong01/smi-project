import {
  ArrowLeft,
  BookOpen,
  Building2,
  Clock3,
  Database,
  ExternalLink,
  Landmark,
  Link2,
  RefreshCw,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  extractionRuns,
  liveResearchMeta,
  liveResearchSources,
} from "../data/researchProjectData.js";
import { getSourceAdapterMeta } from "../data/sourceRegistry.js";

const SOURCE_ICONS = {
  BookOpen,
  Link2,
  Building2,
  Landmark,
  UserCheck,
};

function formatDateTime(value) {
  if (!value) {
    return "Not recorded";
  }

  return new Date(value).toLocaleString();
}

export default function SourceStatus() {
  const refreshMinutes = Math.round(
    (liveResearchMeta.testingRefreshIntervalMs ?? 0) / 60000
  );

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
        <article className="detail-card wide">
          <h2>
            <ShieldCheck size={20} />
            Configured Source Health
          </h2>
          <div className="source-monitor-grid">
            {liveResearchMeta.sourceStatus.map((source) => {
              const meta = getSourceAdapterMeta(source.sourceId);
              const Icon = meta ? SOURCE_ICONS[meta.icon] : null;

              return (
              <article className="source-monitor-card" key={source.sourceId}>
                <div className="source-monitor-heading">
                  {Icon ? <Icon size={20} aria-hidden="true" /> : null}
                  <div>
                    <p className="eyebrow">{source.extractionType}</p>
                    <h3>{source.sourceName}</h3>
                  </div>
                </div>
                {meta ? (
                  <p className="source-monitor-description">
                    {meta.description}{" "}
                    {meta.homepage ? (
                      <a
                        href={meta.homepage}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        Visit source <ExternalLink size={13} aria-hidden="true" />
                      </a>
                    ) : null}
                  </p>
                ) : null}
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
              );
            })}
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
