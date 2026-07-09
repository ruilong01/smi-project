import {
  ArrowLeft,
  BrainCircuit,
  Building2,
  Database,
  FlaskConical,
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
} from "../data/researchProjectData.js";
import { getSourcesByIds } from "../data/sourceRegistry.js";
import { getTopicSlug } from "../data/topicData.js";
import {
  getIntensityColor,
  getIntensityLabel,
} from "../utils/intensity.js";

function DetailList({ items, emptyText = "No extracted records yet." }) {
  if (!items?.length) {
    return <p className="source-empty">{emptyText}</p>;
  }

  return (
    <ul className="detail-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function CountryProjectList({ projects }) {
  if (!projects?.length) {
    return <p className="source-empty">No extracted project records yet.</p>;
  }

  return (
    <div className="project-index-list compact">
      {projects.map((project) => (
        <Link key={project.id} to={`/projects/${project.slug}`}>
          <strong>{project.title}</strong>
          <span>{project.leadOrganisation}</span>
          <small>{project.displayScore}/100 evidence score</small>
        </Link>
      ))}
    </div>
  );
}

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
          <small>Calculated from verified project, institution and publication relationships.</small>
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
              <Link
                className="tag topic-link"
                key={theme}
                to={`/topic/${getTopicSlug(theme)}`}
              >
                {theme}
              </Link>
            ))}
          </div>
        </article>

        <article className="detail-card">
          <h2>
            <Building2 size={20} />
            Institutions
          </h2>
          <DetailList items={country.institutions} />
        </article>

        <article className="detail-card">
          <h2>
            <FlaskConical size={20} />
            Displayed Projects
          </h2>
          <CountryProjectList projects={countryProjects} />
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
