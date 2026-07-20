import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Link } from "react-router-dom";
import InstitutionLink from "./InstitutionLink.jsx";
import TopicTag from "./TopicTag.jsx";

function compactDate(value) {
  if (!value) {
    return "Not recorded";
  }
  return String(value).slice(0, 10);
}

// Per-record image/source preview card. Shows the first image candidate
// (sourcePages[0].images[0]) as a linked thumbnail when one exists; falls
// back to "Image candidate not available yet" with the source link kept
// visible when it doesn't. If the image URL 404s or otherwise fails to
// load, swaps to the same source-card fallback rather than showing a
// broken image icon.
function RecordImagePreview({ project }) {
  const [imageFailed, setImageFailed] = useState(false);
  const sourcePage = project.sourcePages?.[0];
  const image = sourcePage?.images?.[0];
  const sourceUrl = sourcePage?.sourceUrl;

  if (image?.imageUrl && !imageFailed) {
    return (
      <a
        className="research-record-image-card"
        href={sourceUrl || image.sourceUrl}
        rel="noreferrer"
        target="_blank"
        title={image.caption || image.altText || "View source"}
      >
        <img
          alt={image.altText || image.caption || ""}
          className="research-record-image-thumb"
          loading="lazy"
          onError={() => setImageFailed(true)}
          src={image.imageUrl}
        />
      </a>
    );
  }

  return (
    <span className="research-record-image-placeholder">
      <ImageOff aria-hidden="true" size={13} />
      <span>
        Image candidate not available yet
        {sourceUrl ? (
          <>
            {" "}
            <a href={sourceUrl} rel="noreferrer" target="_blank">
              Source
            </a>
          </>
        ) : null}
      </span>
    </span>
  );
}

/**
 * One research-record row: title link, a secondary identifier (institution
 * by default, or country/role when the page context already implies the
 * institution — see InstitutionDetail), date, and a topic tag. Shared by
 * the country profile panel, the country detail page and the institution
 * detail page, which previously each reimplemented this independently.
 */
export function ResearchRecordRow({ project, showInstitution = true, extraLabel }) {
  return (
    <li className="research-record-row">
      <div className="research-record-main">
        <Link className="research-record-title" to={`/projects/${project.slug}`}>
          {project.title}
        </Link>
        <div className="research-record-meta">
          {showInstitution ? (
            <InstitutionLink name={project.leadOrganisation} />
          ) : (
            <span>{project.country}</span>
          )}
          <span>{compactDate(project.startDate || project.lastVerifiedAt)}</span>
          <span>{extraLabel ?? project.extractionMethod}</span>
        </div>
      </div>
      <RecordImagePreview project={project} />
      {project.researchCategories?.[0] ? (
        <TopicTag
          category={project.researchCategories[0]}
          className="tag topic-link research-record-topic"
        />
      ) : null}
    </li>
  );
}

export default function ResearchRecordList({
  projects,
  showInstitution = true,
  extraLabel,
  emptyText = "No extracted records yet.",
}) {
  if (!projects?.length) {
    return <p className="source-empty">{emptyText}</p>;
  }

  return (
    <ul className="research-record-list">
      {projects.map((project) => (
        <ResearchRecordRow
          extraLabel={extraLabel}
          key={project.id}
          project={project}
          showInstitution={showInstitution}
        />
      ))}
    </ul>
  );
}
