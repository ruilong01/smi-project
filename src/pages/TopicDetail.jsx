import {
  Anchor,
  ArrowLeft,
  BrainCircuit,
  Container,
  Database,
  Fuel,
  Globe2,
  Leaf,
  Radar,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import {
  countryMatchesTopicFilter,
  getInstitutionSlugForName,
  getLiveDataStatusLabel,
  liveResearchCountries,
  projectMatchesTopicFilter,
  publicResearchProjects,
} from "../data/researchProjectData.js";
import {
  getTopicBySlug,
  topicData,
} from "../data/topicData.js";

const topicIcons = {
  leaf: Leaf,
  container: Container,
  radar: Radar,
  brain: BrainCircuit,
  fuel: Fuel,
  shield: ShieldCheck,
};

function ListCard({ title, items }) {
  return (
    <article className="detail-card topic-list-card">
      <h2>{title}</h2>
      <ul className="detail-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

function TopicReferenceGrid({ items, label, topic }) {
  if (!items.length) {
    return <p className="source-empty">No extracted records are matched yet.</p>;
  }

  return (
    <div className="topic-reference-grid">
      {items.map((item) => {
        const institutionSlug = getInstitutionSlugForName(item);
        return (
          <article className="topic-reference-card" key={item}>
            <span>{label}</span>
            {institutionSlug ? (
              <strong>
                <Link className="institution-link" to={`/institution/${institutionSlug}`}>
                  {item}
                </Link>
              </strong>
            ) : (
              <strong>{item}</strong>
            )}
            <Link className="topic-mini-link" to={`/topic/${topic.slug}`}>
              {topic.name}
            </Link>
          </article>
        );
      })}
    </div>
  );
}

function ProjectReferenceGrid({ projects }) {
  if (!projects.length) {
    return <p className="source-empty">No extracted project records are matched yet.</p>;
  }

  return (
    <div className="topic-reference-grid">
      {projects.map((project) => (
        <Link
          className="topic-reference-card"
          key={project.id}
          to={`/projects/${project.slug}`}
        >
          <span>{project.country}</span>
          <strong>{project.title}</strong>
          <small>{project.displayScore}/100 evidence score</small>
        </Link>
      ))}
    </div>
  );
}

export default function TopicDetail() {
  const { slug } = useParams();
  const topic = getTopicBySlug(slug);

  if (!topic) {
    return (
      <main className="topic-shell">
        <div className="ocean-grid" aria-hidden="true" />
        <section className="detail-card not-found">
          <p className="eyebrow">No topic found</p>
          <h1>Research topic unavailable</h1>
          <Link className="back-link" to="/">
            <ArrowLeft size={18} />
            Back to Map
          </Link>
        </section>
      </main>
    );
  }

  const Icon = topicIcons[topic.iconKey] ?? Anchor;
  const relatedCountries = liveResearchCountries.filter((country) =>
    countryMatchesTopicFilter(country, topic.name)
  );
  const relatedProjects = publicResearchProjects.filter((project) =>
    projectMatchesTopicFilter(project, topic.name)
  );
  const relatedInstitutions = [
    ...new Set(
      relatedProjects.flatMap((project) => [
        project.leadOrganisation,
        ...(project.partnerOrganisations ?? []),
      ])
    ),
  ].filter(Boolean);

  return (
    <main className="topic-shell">
      <div className="ocean-grid" aria-hidden="true" />

      <section className="topic-hero">
        <Link className="back-link" to="/">
          <ArrowLeft size={18} />
          Back to Map
        </Link>
        <div className="topic-title-row">
          <span className="topic-icon">
            <Icon size={30} />
          </span>
          <div>
            <p className="eyebrow">Maritime research topic</p>
            <h1>{topic.name}</h1>
          </div>
        </div>
        <p className="topic-lede">{topic.shortDescription}</p>
        <div className="detail-status-pill">
          {getLiveDataStatusLabel()}
        </div>
      </section>

      <section className="topic-grid">
        <article className="detail-card topic-overview-card">
          <h2>
            <Sparkles size={20} />
            Topic Overview
          </h2>
          <p>{topic.overview}</p>
        </article>

        <ListCard title="Key Technology Areas" items={topic.keyTechnologies} />
        <ListCard title="Key Applications" items={topic.keyApplications} />

        <article className="detail-card topic-distribution-card">
          <h2>
            <Globe2 size={20} />
            Global Country Distribution
          </h2>
          <strong>{relatedCountries.length}</strong>
          <p>
            Countries matched to {topic.name} through extracted project and
            institution relationships.
          </p>
        </article>

        <article className="detail-card wide">
          <h2>Related Countries</h2>
          <div className="topic-country-grid">
            {relatedCountries.map((country) => (
              <Link
                className="topic-country-card"
                key={country.code}
                to={`/country/${country.slug}`}
              >
                <span>{country.region || "Extracted cluster"}</span>
                <strong>{country.name}</strong>
                <b>{country.researchIntensity}</b>
              </Link>
            ))}
          </div>
        </article>

        <article className="detail-card wide">
          <h2>Relevant Institutions</h2>
          <TopicReferenceGrid
            items={relatedInstitutions}
            label="Institution"
            topic={topic}
          />
        </article>

        <article className="detail-card wide">
          <h2>Matched Projects</h2>
          <ProjectReferenceGrid projects={relatedProjects} />
        </article>

        <ListCard title="Current Research Trends" items={topic.trends} />

        <article className="detail-card topic-data-card">
          <h2>
            <Database size={20} />
            Data Status
          </h2>
          <p>
            Topic matches are assembled from extracted project categories,
            country relationships and institution relationships in the generated
            evidence dataset.
          </p>
        </article>

        <article className="detail-card wide topic-index-card">
          <h2>All Research Topics</h2>
          <div className="topic-index-list">
            {topicData.map((item) => (
              <Link
                className={item.slug === topic.slug ? "active" : ""}
                key={item.slug}
                to={`/topic/${item.slug}`}
              >
                {item.name}
              </Link>
            ))}
          </div>
        </article>
      </section>
    </main>
  );
}
