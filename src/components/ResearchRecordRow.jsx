import { Link } from "react-router-dom";
import InstitutionLink from "./InstitutionLink.jsx";
import TopicTag from "./TopicTag.jsx";

function compactDate(value) {
  if (!value) {
    return "Not recorded";
  }
  return String(value).slice(0, 10);
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
