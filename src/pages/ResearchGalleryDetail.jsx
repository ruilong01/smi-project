import { ArrowLeft, ExternalLink, ImageOff } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { getGalleryRecordById, getVerificationStatusLabel } from "../data/researchGalleryData.js";
import CountryFlagBadge from "../components/CountryFlagBadge.jsx";

function DetailImage({ record }) {
  const image = record.images?.[0];

  if (!image) {
    return (
      <figure className="project-hero-image placeholder">
        <div className="project-image-placeholder">
          <ImageOff size={34} />
          <span>Image candidate not available yet</span>
        </div>
        <figcaption>
          {record.sourceUrl ? (
            <a href={record.sourceUrl} rel="noreferrer" target="_blank">
              View official source instead
            </a>
          ) : (
            "No source URL recorded for this record."
          )}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure className="project-hero-image">
      <img alt={image.altText || image.caption || record.title} src={image.imageUrl} />
      <figcaption>
        {image.caption || image.altText || "Untitled figure"}
        {image.sourceName ? <span> Source: {image.sourceName}.</span> : null}
        <span> {image.rightsNote || "Rights not verified — source preview only."}</span>
      </figcaption>
    </figure>
  );
}

function formatEur(amount) {
  if (amount == null) return null;
  return `€${Math.round(amount).toLocaleString("en-US")}`;
}

function ExplanationSection({ title, text }) {
  if (!text) {
    return null;
  }
  return (
    <div className="gallery-explanation-block">
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

export default function ResearchGalleryDetail() {
  const { recordId } = useParams();
  const record = getGalleryRecordById(recordId);

  if (!record) {
    return (
      <main className="detail-shell gallery-shell">
        <div className="ocean-grid" aria-hidden="true" />
        <section className="gallery-hero">
          <Link className="back-link" to="/research-gallery">
            <ArrowLeft size={18} />
            Back to Research Gallery
          </Link>
          <h1>Record not found</h1>
          <p>No research record with id "{recordId}" exists in the current dataset.</p>
        </section>
      </main>
    );
  }

  const evaluation = record.evaluation;
  const otherImages = (record.images ?? []).slice(1, 6);

  return (
    <main className="detail-shell project-detail-shell">
      <div className="ocean-grid" aria-hidden="true" />

      <section className="project-hero">
        <Link className="back-link" to="/research-gallery">
          <ArrowLeft size={18} />
          Back to Research Gallery
        </Link>

        <div className="project-hero-grid">
          <DetailImage record={record} />
          <div className="project-hero-copy">
            <p className="eyebrow">{record.sourceDatabase || "Extracted record"}</p>
            <h1>{record.title}</h1>
            <div className="project-meta-row">
              {record.acronym ? <span>{record.acronym}</span> : null}
              {record.countryOrRegion ? (
                <span>
                  <CountryFlagBadge countryCode={record.countryCode} /> {record.countryOrRegion}
                </span>
              ) : null}
              {record.coordinator ? <span>Coordinator: {record.coordinator}</span> : null}
              <span>{(record.followUpStatus || "").replace(/_/g, " ") || "Status not recorded"}</span>
            </div>
            <div className="project-category-list">
              {[record.topicPrimary, record.topicSecondary].filter(Boolean).map((topic) => (
                <span className="tag" key={topic}>
                  {topic}
                </span>
              ))}
            </div>
            <p>{record.summary || "No summary available yet."}</p>
            {record.sourceUrl ? (
              <a className="gallery-open-source" href={record.sourceUrl} rel="noreferrer" target="_blank">
                View source — {record.sourceDatabase || "project page"}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>
      </section>

      <section className="project-detail-grid">
        <article className="detail-card project-at-glance">
          <h2>At a Glance</h2>
          <dl>
            {record.actionabilityScore != null ? (
              <div className="project-info-item">
                <dt>Actionability score</dt>
                <dd>{record.actionabilityScore}/100</dd>
              </div>
            ) : null}
            {record.relevanceScore != null ? (
              <div className="project-info-item">
                <dt>Relevance score</dt>
                <dd>{record.relevanceScore}/100</dd>
              </div>
            ) : null}
            <div className="project-info-item">
              <dt>Data quality</dt>
              <dd>{getVerificationStatusLabel(record.verificationStatus)}</dd>
            </div>
            <div className="project-info-item">
              <dt>Recency</dt>
              <dd>{(record.recencyCategory || "unknown").replace(/_/g, " ")}</dd>
            </div>
            {record.startDate || record.endDate ? (
              <div className="project-info-item">
                <dt>Project timeline</dt>
                <dd>
                  {record.startDate || "unknown start"} – {record.endDate || "unknown end"}
                </dd>
              </div>
            ) : null}
            {record.fundedUnder?.length ? (
              <div className="project-info-item">
                <dt>Funded under</dt>
                <dd>{record.fundedUnder.join(", ")}</dd>
              </div>
            ) : null}
            {record.totalCostEur != null ? (
              <div className="project-info-item">
                <dt>Total project cost</dt>
                <dd>{formatEur(record.totalCostEur)}</dd>
              </div>
            ) : null}
            {record.euContributionEur != null ? (
              <div className="project-info-item">
                <dt>EU contribution</dt>
                <dd>{formatEur(record.euContributionEur)}</dd>
              </div>
            ) : null}
            {record.doi ? (
              <div className="project-info-item">
                <dt>DOI</dt>
                <dd>
                  <a href={`https://doi.org/${record.doi}`} rel="noreferrer" target="_blank">
                    {record.doi}
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </article>

        {evaluation ? (
          <article className="detail-card wide">
            <h2>Research Explanation</h2>
            <ExplanationSection title="Plain-language explanation" text={evaluation.plainLanguageExplanation} />
            <ExplanationSection title="Problem being addressed" text={evaluation.problemBeingAddressed} />
            <ExplanationSection title="Technology approach" text={evaluation.technologyApproach} />
            <ExplanationSection title="Maritime relevance" text={evaluation.maritimeRelevance} />
            <ExplanationSection title="Possible application" text={evaluation.possibleApplication} />
            <ExplanationSection title="Why it matters" text={evaluation.whyItMatters} />
            <ExplanationSection title="Follow-up / action signal" text={evaluation.followUpOrActionSignal} />
            <ExplanationSection title="Limitations" text={evaluation.limitations} />
            <p className="source-empty">
              {evaluation.explanationProvenance?.aiGenerated
                ? `AI-generated (${evaluation.explanationProvenance.model || "model not recorded"}).`
                : "Heuristically assembled from this record's own source fields — not AI-generated."}
              {" "}Based on: {(evaluation.explanationProvenance?.basedOnFields ?? []).join(", ") || "source metadata"}.
            </p>
          </article>
        ) : null}

        {otherImages.length ? (
          <article className="detail-card wide">
            <h2>Additional Image Candidates ({otherImages.length})</h2>
            <p className="source-empty">Rights not verified — source preview only, not official images.</p>
            <div className="image-candidate-grid">
              {otherImages.map((image) => (
                <a
                  className="image-candidate-card"
                  href={image.sourceUrl}
                  key={image.imageUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <img alt={image.altText || "Image candidate"} src={image.imageUrl} />
                  <span>{image.caption || image.altText || "Untitled figure"}</span>
                </a>
              ))}
            </div>
          </article>
        ) : null}

        <article className="detail-card wide">
          <h2>Sources and Evidence</h2>
          <ul className="gallery-source-list">
            {record.sourceUrl ? (
              <li>
                <a href={record.sourceUrl} rel="noreferrer" target="_blank">
                  {record.sourceDatabase || "Source"} project page
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              </li>
            ) : null}
            {(record.images ?? []).map((image) => (
              <li key={`source-${image.imageUrl}`}>
                <a href={image.sourceUrl} rel="noreferrer" target="_blank">
                  {image.sourceName || "Image source"}
                  <ExternalLink size={13} aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
          {!record.sourceUrl && !(record.images ?? []).length ? (
            <p className="source-empty">No source links recorded for this record.</p>
          ) : null}
        </article>
      </section>
    </main>
  );
}
