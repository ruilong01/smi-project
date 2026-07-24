import { ArrowLeft, ExternalLink, Gauge, ImageOff } from "lucide-react";
import { Link } from "react-router-dom";
import { enrichedGalleryRecords, galleryRecords } from "../data/researchGalleryData.js";

function GalleryImagePreview({ record }) {
  const image = record.images?.[0];

  if (!image) {
    return (
      <div className="gallery-card-image placeholder">
        <ImageOff size={22} aria-hidden="true" />
        <span>Image candidate not available yet</span>
      </div>
    );
  }

  return (
    <div className="gallery-card-image">
      <img
        alt={image.altText || image.caption || record.title}
        loading="lazy"
        onError={(event) => {
          event.currentTarget.parentElement.classList.add("placeholder");
          event.currentTarget.remove();
        }}
        src={image.imageUrl}
      />
    </div>
  );
}

function GalleryCard({ record }) {
  return (
    <article className="gallery-card">
      <GalleryImagePreview record={record} />
      <div className="gallery-card-body">
        <p className="eyebrow">{record.acronym || record.sourceDatabase}</p>
        <h3>
          <Link to={`/research-gallery/${record.recordId}`}>{record.title}</Link>
        </h3>
        <div className="gallery-card-tags">
          {[record.topicPrimary, record.topicSecondary].filter(Boolean).map((topic) => (
            <span className="tag" key={topic}>
              {topic}
            </span>
          ))}
        </div>
        <p className="gallery-card-summary">
          {record.evaluation?.whyItMatters || record.summary || "No summary available yet in current source data."}
        </p>
        <div className="gallery-card-scores">
          {record.actionabilityScore != null ? (
            <span>
              <Gauge size={13} aria-hidden="true" />
              Actionability {record.actionabilityScore}/100
            </span>
          ) : null}
          {record.relevanceScore != null ? <span>Relevance {record.relevanceScore}/100</span> : null}
        </div>
        <div className="gallery-card-actions">
          <Link className="gallery-view-details" to={`/research-gallery/${record.recordId}`}>
            View Details
          </Link>
          {record.sourceUrl ? (
            <a className="gallery-open-source" href={record.sourceUrl} rel="noreferrer" target="_blank">
              Open Source
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function ResearchGallery() {
  const enrichedIds = new Set(enrichedGalleryRecords.map((record) => record.recordId));
  const otherRecords = galleryRecords.filter((record) => !enrichedIds.has(record.recordId));

  return (
    <main className="detail-shell gallery-shell">
      <div className="ocean-grid" aria-hidden="true" />

      <section className="gallery-hero">
        <Link className="back-link" to="/">
          <ArrowLeft size={18} />
          Back to Map
        </Link>
        <p className="eyebrow">Research Intelligence Gallery — optional browse index</p>
        <h1>Enriched Maritime R&amp;D Records</h1>
        <p className="gallery-hero-note">
          This is a secondary, flat index of every extracted record. The main way to explore the
          dataset is the map: click a country, then an institution, to see the same image-ready
          records in context. Records below have real image candidates and/or explanations
          generated from their own source data — nothing here is invented.
        </p>
      </section>

      {enrichedGalleryRecords.length ? (
        <section className="gallery-section">
          <h2>Enriched records ({enrichedGalleryRecords.length})</h2>
          <div className="gallery-grid">
            {enrichedGalleryRecords.map((record) => (
              <GalleryCard key={record.recordId} record={record} />
            ))}
          </div>
        </section>
      ) : null}

      {otherRecords.length ? (
        <section className="gallery-section">
          <h2>Other extracted records — coverage pending enrichment ({otherRecords.length})</h2>
          <p className="source-empty">
            These records are real and source-linked but have not yet had image candidates fetched
            or explanations generated.
          </p>
          <ul className="gallery-plain-list">
            {otherRecords.map((record) => (
              <li key={record.recordId}>
                <Link to={`/research-gallery/${record.recordId}`}>{record.title}</Link>
                {record.sourceUrl ? (
                  <a href={record.sourceUrl} rel="noreferrer" target="_blank">
                    Open Source
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
