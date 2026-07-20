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
import { useMemo } from "react";
import SourceCard from "../components/SourceCard.jsx";
import InstitutionLink from "../components/InstitutionLink.jsx";
import TopicTag from "../components/TopicTag.jsx";
import ResearchRecordList from "../components/ResearchRecordRow.jsx";
import {
  formatRelationType,
  getCountryBySlug,
  getLiveDataStatusLabel,
  getProjectsForCountry,
  getRelationshipEvidenceSources,
  getResearchProjectById,
} from "../data/researchProjectData.js";
import { getSourcesByIds } from "../data/sourceRegistry.js";
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

  const { countryProjects, institutionRecordCounts, sources } = useMemo(() => {
    if (!country) {
      return { countryProjects: [], institutionRecordCounts: new Map(), sources: [] };
    }
    const projects = getProjectsForCountry(country.name);
    const counts = new Map();
    projects.forEach((project) => {
      if (!project.leadOrganisation) return;
      counts.set(project.leadOrganisation, (counts.get(project.leadOrganisation) ?? 0) + 1);
    });
    return {
      countryProjects: projects,
      institutionRecordCounts: counts,
      sources: getSourcesByIds(country.sources ?? []),
    };
  }, [country]);

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
            Research intensity is a relative score based on the number of
            maritime R&amp;D records, active institutions and topic
            diversity in the current dataset. It is not an official
            national ranking.
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
            {(country.themes ?? []).map((theme) => (
              <TopicTag category={theme} key={theme} />
            ))}
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
                  <InstitutionLink name={name} />
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
          <ResearchRecordList projects={countryProjects} />
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
