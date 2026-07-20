import {
  ArrowLeft,
  CalendarDays,
  Database,
  FlaskConical,
  ImageOff,
  MapPin,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import OrganisationCard from "../components/OrganisationCard.jsx";
import SourceCard from "../components/SourceCard.jsx";
import TechnologyCard from "../components/TechnologyCard.jsx";
import Timeline from "../components/Timeline.jsx";
import {
  getResearchProjectBySlug,
  getInstitutionSlugForName,
  getRelationshipEntityLabel,
  getRelationshipEvidenceSources,
  getRelationshipsForProject,
  formatRelationType,
  publicResearchProjects,
} from "../data/researchProjectData.js";
import { getSourcesForProject } from "../data/sourceRegistry.js";
import { isValidExternalUrl } from "../utils/url.js";

function InfoItem({ label, value }) {
  if (!value || (Array.isArray(value) && value.length === 0)) {
    return null;
  }

  return (
    <div className="project-info-item">
      <dt>{label}</dt>
      <dd>{Array.isArray(value) ? value.join(", ") : value}</dd>
    </div>
  );
}

function compactDate(value) {
  if (!value) {
    return "Not recorded";
  }

  return String(value).slice(0, 10);
}

function RelationshipCard({ relationship }) {
  const evidenceSources = getRelationshipEvidenceSources(relationship);

  return (
    <article className="relationship-card">
      <div>
        <p className="eyebrow">{relationship.sourceEntityType.toLowerCase()}</p>
        <h3>{getRelationshipEntityLabel(relationship)}</h3>
        <span>{formatRelationType(relationship.relationType)}</span>
      </div>
      <p>{relationship.explanationData?.text}</p>
      <dl className="relationship-meta">
        <div>
          <dt>Confidence</dt>
          <dd>{relationship.confidence}/100</dd>
        </div>
        <div>
          <dt>Verified</dt>
          <dd>{compactDate(relationship.lastVerifiedAt)}</dd>
        </div>
      </dl>
      <div className="relationship-source-list">
        {evidenceSources.slice(0, 3).map((source) => (
          <a href={source.url} key={source.id} rel="noreferrer" target="_blank">
            {source.publisher}
          </a>
        ))}
      </div>
    </article>
  );
}

function ProjectImage({ project }) {
  const image = project.images?.[0];
  const hasVerifiedImage =
    image && image.url && isValidExternalUrl(image.url) && image.licence;

  return (
    <figure className={`project-hero-image ${hasVerifiedImage ? "" : "placeholder"}`}>
      {hasVerifiedImage ? (
        <img alt={image.caption} src={image.url} />
      ) : (
        <div className="project-image-placeholder">
          <ImageOff size={34} />
          <span>No verified project image</span>
        </div>
      )}
      <figcaption>
        {image?.caption ??
          "No verified image is available; placeholder shown for this MVP."}
        {image?.attributionRequired ? (
          <span>
            Image: {image.creator}. Licence: {image.licence}.
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}

function ResearchOutputList({ outputs }) {
  if (!outputs.length) {
    return <p className="source-empty">No sourced outputs are attached yet.</p>;
  }

  return (
    <div className="research-output-grid">
      {outputs.map((output) => (
        <article className="research-output-card" key={`${output.type}-${output.title}`}>
          <p className="eyebrow">{output.type}</p>
          <h3>{output.title}</h3>
          <span>{output.date}</span>
          {output.status ? <b>{output.status}</b> : null}
        </article>
      ))}
    </div>
  );
}

export default function ProjectDetail() {
  const { projectSlug } = useParams();
  const project = getResearchProjectBySlug(projectSlug);

  if (!project) {
    return (
      <main className="detail-shell project-detail-shell">
        <div className="ocean-grid" aria-hidden="true" />
        <section className="detail-card not-found">
          <p className="eyebrow">No project found</p>
          <h1>Project unavailable</h1>
          <Link className="back-link" to="/">
            <ArrowLeft size={18} />
            Back to Map
          </Link>
        </section>
      </main>
    );
  }

  const sources = getSourcesForProject(project);
  const projectImageCandidates = (project.sourcePages ?? []).flatMap(
    (page) => page.images ?? []
  );
  const relationships = getRelationshipsForProject(project.id);
  const countryRelationships = relationships.filter(
    (relationship) => relationship.sourceEntityType === "COUNTRY"
  );
  const institutionRelationships = relationships.filter(
    (relationship) => relationship.sourceEntityType === "INSTITUTION"
  );
  const locationLabel = [project.city, project.country].filter(Boolean).join(", ");

  return (
    <main className="detail-shell project-detail-shell">
      <div className="ocean-grid" aria-hidden="true" />

      <section className="project-hero">
        <Link className="back-link" to="/">
          <ArrowLeft size={18} />
          Back to Map
        </Link>

        <div className="project-hero-grid">
          <ProjectImage project={project} />
          <div className="project-hero-copy">
            <p className="eyebrow">Evidence-based project profile</p>
            <h1>{project.title}</h1>
            <div className="project-meta-row">
              <span>
                <MapPin size={16} />
                {locationLabel}
              </span>
              <span>{project.projectStatus}</span>
              <span>Verified {project.lastVerifiedDate}</span>
              <span>Extracted {compactDate(project.lastUpdatedAt ?? project.firstSeenAt)}</span>
            </div>
            <div className="project-category-list">
              {(project.researchCategories ?? []).map((category) => (
                <span className="tag" key={category}>
                  {category}
                </span>
              ))}
            </div>
            <p>{project.plainLanguageSummary}</p>
            <div className={`evidence-confidence ${project.displayTier}`}>
              <ShieldCheck size={18} />
              <strong>{project.displayScore}/100 display score</strong>
              <span>{project.displayTier} marker</span>
            </div>
          </div>
        </div>
      </section>

      <section className="project-detail-grid">
        <article className="detail-card project-at-glance">
          <h2>
            <Database size={20} />
            At a Glance
          </h2>
          <dl>
            <InfoItem label="Project type" value={project.entityType} />
            <InfoItem label="Research focus" value={project.researchCategories ?? []} />
            <InfoItem label="Lead organisation" value={project.leadOrganisation} />
            <InfoItem label="Partners" value={project.partnerOrganisations ?? []} />
            <InfoItem
              label="Location"
              value={`${locationLabel} (${project.locationDisplayLevel} level)`}
            />
            <InfoItem
              label="Project period"
              value={[
                project.startDate,
                project.endDate ? project.endDate : "ongoing",
              ]
                .filter(Boolean)
                .join(" to ")}
            />
            <InfoItem label="Current status" value={project.projectStatus} />
            <InfoItem label="Funding" value={project.fundingInformation} />
            <InfoItem
              label="Evidence confidence"
              value={`${project.displayScore}/100`}
            />
          </dl>
        </article>

        <article className="detail-card wide">
          <h2>
            <FlaskConical size={20} />
            Project Overview
          </h2>
          <div className="project-overview-stack">
            <section>
              <h3>Plain-language explanation</h3>
              <p>{project.plainLanguageSummary}</p>
            </section>
            <section>
              <h3>Problem being addressed</h3>
              <p>{project.problemAddressed}</p>
            </section>
            {project.proposedSolution ? (
              <section>
                <h3>Proposed solution</h3>
                <p>{project.proposedSolution}</p>
              </section>
            ) : null}
            {project.expectedImpact ? (
              <section>
                <h3>Expected impact</h3>
                <p>{project.expectedImpact}</p>
              </section>
            ) : null}
          </div>
        </article>

        <article className="detail-card wide">
          <h2>Technology Explanation</h2>
          <div className="technology-grid">
            {(project.keyTechnologies ?? []).map((technology) => (
              <TechnologyCard key={technology} technology={technology} />
            ))}
          </div>
        </article>

        <article className="detail-card">
          <h2>
            <CalendarDays size={20} />
            Timeline
          </h2>
          <Timeline milestones={project.milestones ?? []} />
        </article>

        <article className="detail-card wide">
          <h2>Organisations</h2>
          <div className="organisation-grid">
            <OrganisationCard
              name={project.leadOrganisation}
              role="Lead institution"
              slug={getInstitutionSlugForName(project.leadOrganisation)}
            />
            {(project.partnerOrganisations ?? []).map((organisation) => (
              <OrganisationCard
                key={organisation}
                name={organisation}
                role="Research partner"
                slug={getInstitutionSlugForName(organisation)}
              />
            ))}
          </div>
        </article>

        <article className="detail-card wide">
          <h2>Research Outputs</h2>
          <ResearchOutputList outputs={project.researchOutputs ?? []} />
        </article>

        <article className="detail-card wide evidence-relationships-card">
          <h2>Explainable Relationships</h2>
          <p>
            These country, institution and project links are generated from
            extracted relationship records and keep their source IDs attached.
          </p>
          <div className="relationship-grid">
            {[...countryRelationships, ...institutionRelationships].map(
              (relationship) => (
                <RelationshipCard
                  key={relationship.id}
                  relationship={relationship}
                />
              )
            )}
          </div>
        </article>

        <article className="detail-card wide evidence-reasons-card">
          <h2>Why This Project Is Displayed</h2>
          <ul className="reason-list">
            {(project.displayReasonsText ?? []).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p>
            Projects scoring below 60 are kept out of the public map. This page
            only displays fields with supporting sources or clearly marks
            missing information as unavailable.
          </p>
        </article>

        <article className="detail-card wide">
          <h2>Sources and Evidence</h2>
          <div className="source-grid">
            {sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </article>

        <article className="detail-card wide">
          <h2>
            <Sparkles size={20} />
            Evidence &amp; Media
          </h2>
          {project.selectedEvidence?.length || projectImageCandidates.length ? (
            <>
              {project.selectedEvidence?.length ? (
                <details className="evidence-collapsible" open>
                  <summary>
                    Selected evidence ({project.selectedEvidence.length})
                  </summary>
                  <ul className="evidence-snippet-list">
                    {project.selectedEvidence.slice(0, 5).map((evidence) => (
                      <li className="evidence-snippet-card" key={evidence.evidenceId}>
                        <p className="eyebrow">{evidence.evidenceType}</p>
                        <p className="evidence-snippet-text">
                          &ldquo;{evidence.snippet}&rdquo;
                        </p>
                        <p className="evidence-snippet-why">{evidence.whyImportant}</p>
                        {isValidExternalUrl(evidence.sourceUrl) ? (
                          <a href={evidence.sourceUrl} rel="noreferrer" target="_blank">
                            {evidence.sourceName || "View source"}
                          </a>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {projectImageCandidates.length ? (
                <details className="evidence-collapsible">
                  <summary>
                    Image candidates ({projectImageCandidates.length})
                  </summary>
                  <p className="source-empty">
                    Rights not verified — shown as source preview only, not
                    an official project image.
                  </p>
                  <div className="image-candidate-grid">
                    {projectImageCandidates.slice(0, 6).map((image) => (
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
                </details>
              ) : null}
            </>
          ) : (
            <p className="source-empty">
              Detailed evidence not available yet for this project.
            </p>
          )}
        </article>

        <article className="detail-card wide project-index-card">
          <h2>Displayed Projects</h2>
          <div className="project-index-list">
            {publicResearchProjects.map((displayedProject) => (
              <Link
                className={
                  displayedProject.id === project.id ? "active" : ""
                }
                key={displayedProject.id}
                to={`/projects/${displayedProject.slug}`}
              >
                <strong>{displayedProject.title}</strong>
                <span>{displayedProject.country}</span>
              </Link>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
