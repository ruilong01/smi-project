import {
  ArrowLeft,
  BrainCircuit,
  Building2,
  Database,
  FlaskConical,
  Info,
  ShieldCheck,
  Ship,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import SourceCard from "../components/SourceCard.jsx";
import {
  formatRelationType,
  getCountryBySlug,
  getLiveDataStatusLabel,
  getProjectsForCountry,
  getRelationshipEvidenceSources,
  getResearchProjectById,
  getTopicNameForCategory,
} from "../data/researchProjectData.js";
import { getSourcesByIds } from "../data/sourceRegistry.js";
import { getTopicSlug } from "../data/topicData.js";
import {
  getIntensityColor,
  getIntensityLabel,
} from "../utils/intensity.js";

function CountryRelationshipList({ relationships }) {
  if (!relationships?.length) {
    return <p className="source-empty">No relationship records are attached.</p>;
  }

  return (
    <div className="why-related-grid">
      {relationships.map((relationship) => {
        const project = getResearchProjectById(relationship.targetEntityId);
        const sources = getRelationshipEvidenceSources(relationship);

        return (
          <article className="why-related-card" key={relationship.id}>
            <p className="eyebrow">{formatRelationType(relationship.relationType)}</p>
            <h3>
              {project ? (
                <Link to={`/projects/${project.slug}`}>{project.title}</Link>
              ) : (
                relationship.targetEntityId
              )}
            </h3>
            <p>{relationship.explanationData?.text}</p>
            <div className="relationship-source-list">
              <span>Confidence {relationship.confidence}/100</span>
              {sources.slice(0, 2).map((source) => (
                <a href={source.url} key={source.id} rel="noreferrer" target="_blank">
                  {source.publisher}
                </a>
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default function CountryDetail() {
  const { slug } = useParams();
  const country = getCountryBySlug(slug);

  if (!country) {
    return (
      <main className="detail-shell">
        <div className="ocean-grid" aria-hidden="true" />
        <section className="detail-card not-found">
          <p className="eyebrow">No profile found</p>
          <h1>Country profile unavailable</h1>
          <Link className="back-link" to="/">
            <ArrowLeft size={18} />
            Back to map
          </Link>
        </section>
      </main>
    );
  }

  const countryProjects = getProjectsForCountry(country.name);
  const sources = getSourcesByIds(country.sources ?? []);
  const institutionRecordCounts = new Map();
  countryProjects.forEach((project) => {
    if (!project.leadOrganisation) return;
    institutionRecordCounts.set(
      project.leadOrganisation,
      (institutionRecordCounts.get(project.leadOrganisation) ?? 0) + 1
    );
  });

  return (
    <main className="detail-shell">
      <div className="ocean-grid" aria-hidden="true" />

      <section className="detail-hero">
        <Link className="back-link" to="/">
          <ArrowLeft size={18} />
          Back to map
        </Link>
        <p className="eyebrow">Country research profile</p>
        <h1>{country.name}</h1>
        <p className="detail-region">{country.region || "Extracted maritime R&D cluster"}</p>
        <p>{country.summary}</p>
        <div className="detail-status-pill data-freshness-pill">
          {getLiveDataStatusLabel()}
        </div>
      </section>

      <section className="detail-grid">
        <article
          className="detail-card intensity-detail"
          style={{
            "--country-accent": getIntensityColor(
              country.researchIntensity,
              false
            ),
          }}
        >
          <span>Research intensity</span>
          <strong>{country.researchIntensity}</strong>
          <em>{getIntensityLabel(country.researchIntensity)}</em>
          <small className="intensity-explainer">
            <Info size={13} />
            Relative score (0-100) from verified project, institution,
            partner and publication relationships for this country, scaled
            against the most active country in the current dataset. Not an
            official ranking and not a measure of research quality — it
            only reflects observed activity in the extracted data.
          </small>
        </article>

        <article className="detail-card">
          <h2>
            <ShieldCheck size={20} />
            Activity Signals
          </h2>
          <dl className="project-at-glance">
            <div className="project-info-item">
              <dt>Verified projects</dt>
              <dd>{country.activity?.verifiedProjects ?? 0}</dd>
            </div>
            <div className="project-info-item">
              <dt>Lead projects</dt>
              <dd>{country.activity?.leadProjects ?? 0}</dd>
            </div>
            <div className="project-info-item">
              <dt>Publications</dt>
              <dd>{country.activity?.publications ?? 0}</dd>
            </div>
          </dl>
        </article>

        <article className="detail-card wide">
          <h2>
            <Ship size={20} />
            Key Maritime Research Themes
          </h2>
          <div className="tag-list">
            {(country.themes ?? []).map((theme) => {
              const topicSlug = getTopicSlug(getTopicNameForCategory(theme));
              return topicSlug ? (
                <Link
                  className="tag topic-link"
                  key={theme}
                  to={`/topic/${topicSlug}`}
                >
                  {theme}
                </Link>
              ) : (
                <span className="tag" key={theme}>
                  {theme}
                </span>
              );
            })}
          </div>
        </article>

        <article className="detail-card">
          <h2>
            <Building2 size={20} />
            Institutions
          </h2>
          {country.institutions?.length ? (
            <ul className="detail-list">
              {country.institutions.map((name) => (
                <li key={name}>
                  {name}
                  {institutionRecordCounts.get(name) ? (
                    <span className="profile-list-count">
                      {" "}
                      ({institutionRecordCounts.get(name)} record
                      {institutionRecordCounts.get(name) === 1 ? "" : "s"})
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="source-empty">No extracted records yet.</p>
          )}
        </article>

        <article className="detail-card wide" id="research-records">
          <h2>
            <FlaskConical size={20} />
            Research Records ({countryProjects.length})
          </h2>
          {countryProjects.length ? (
            <ul className="research-record-list">
              {countryProjects.map((project) => {
                const topicSlug = getTopicSlug(
                  getTopicNameForCategory(project.researchCategories?.[0])
                );
                return (
                  <li className="research-record-row" key={project.id}>
                    <div className="research-record-main">
                      <Link
                        className="research-record-title"
                        to={`/projects/${project.slug}`}
                      >
                        {project.title}
                      </Link>
                      <div className="research-record-meta">
                        <span>{project.leadOrganisation}</span>
                        <span>
                          {(project.startDate || project.lastVerifiedAt || "").slice(0, 10) ||
                            "Not recorded"}
                        </span>
                        <span>{project.extractionMethod}</span>
                      </div>
                    </div>
                    {topicSlug ? (
                      <Link
                        className="tag topic-link research-record-topic"
                        to={`/topic/${topicSlug}`}
                      >
                        {project.researchCategories[0]}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="source-empty">No extracted records yet.</p>
          )}
        </article>

        <article className="detail-card wide ai-detail">
          <h2>
            <BrainCircuit size={20} />
            AI-style Insight
          </h2>
          <p>{country.aiInsight}</p>
        </article>

        <article className="detail-card wide">
          <h2>
            <Database size={20} />
            Why This Country Is Related
          </h2>
          <CountryRelationshipList relationships={country.whyRelated} />
        </article>

        <article className="detail-card wide">
          <h2>
            <Database size={20} />
            Sources and Data Status
          </h2>
          <p>{country.dataStatus}</p>
          <p>Data updated until: {country.dataUpdatedUntil}</p>
          <div className="source-grid">
            {sources.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
