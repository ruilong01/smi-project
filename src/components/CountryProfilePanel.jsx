import { AnimatePresence, motion } from "framer-motion";
import {
  BrainCircuit,
  Building2,
  Database,
  FlaskConical,
  Info,
  MapPin,
  Ship,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { getTopicSlug } from "../data/topicData.js";
import {
  getInstitutionSlugForName,
  getProjectsForCountry,
  getTopicNameForCategory,
} from "../data/researchProjectData.js";
import {
  getIntensityColor,
  getIntensityLabel,
} from "../utils/intensity.js";

const RESEARCH_RECORDS_PREVIEW_COUNT = 6;

function InstitutionList({ institutions, recordCounts }) {
  return (
    <ul className="profile-list">
      {institutions.map((name) => {
        const institutionSlug = getInstitutionSlugForName(name);
        return (
          <li key={name}>
            {institutionSlug ? (
              <Link className="institution-link" to={`/institution/${institutionSlug}`}>
                {name}
              </Link>
            ) : (
              name
            )}
            {recordCounts.get(name) ? (
              <span className="profile-list-count">
                {recordCounts.get(name)} record
                {recordCounts.get(name) === 1 ? "" : "s"}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function compactDate(value) {
  if (!value) {
    return "Not recorded";
  }
  return String(value).slice(0, 10);
}

function ResearchRecordRow({ project }) {
  const topicSlug = getTopicSlug(getTopicNameForCategory(project.researchCategories?.[0]));
  const institutionSlug = getInstitutionSlugForName(project.leadOrganisation);

  return (
    <li className="research-record-row">
      <div className="research-record-main">
        <Link className="research-record-title" to={`/projects/${project.slug}`}>
          {project.title}
        </Link>
        <div className="research-record-meta">
          {institutionSlug ? (
            <Link className="institution-link" to={`/institution/${institutionSlug}`}>
              {project.leadOrganisation}
            </Link>
          ) : (
            <span>{project.leadOrganisation}</span>
          )}
          <span>{compactDate(project.startDate || project.lastVerifiedAt)}</span>
          <span>{project.extractionMethod}</span>
        </div>
      </div>
      {topicSlug ? (
        <Link className="tag topic-link research-record-topic" to={`/topic/${topicSlug}`}>
          {project.researchCategories[0]}
        </Link>
      ) : null}
    </li>
  );
}

export default function CountryProfilePanel({ country, onClose }) {
  const countryProjects = country ? getProjectsForCountry(country.name) : [];
  const institutionRecordCounts = new Map();
  countryProjects.forEach((project) => {
    if (!project.leadOrganisation) return;
    institutionRecordCounts.set(
      project.leadOrganisation,
      (institutionRecordCounts.get(project.leadOrganisation) ?? 0) + 1
    );
  });

  return (
    <AnimatePresence>
      {country ? (
        <motion.aside
          animate={{ x: 0, opacity: 1 }}
          className="country-profile-panel"
          exit={{ x: "104%", opacity: 0 }}
          initial={{ x: "104%", opacity: 0 }}
          transition={{ type: "spring", stiffness: 240, damping: 30 }}
        >
          <div className="profile-panel-header">
            <div>
              <p className="eyebrow">Full country profile</p>
              <h2>{country.name}</h2>
              <span className="profile-region">
                <MapPin size={15} />
                {country.region}
              </span>
            </div>
            <button
              aria-label="Close country profile"
              className="icon-button"
              onClick={onClose}
              type="button"
            >
              <X size={18} />
            </button>
          </div>

          <section
            className="profile-intensity-card"
            style={{
              "--country-accent": getIntensityColor(
                country.researchIntensity,
                false
              ),
            }}
          >
            <span>{getIntensityLabel(country.researchIntensity)}</span>
            <strong>{country.researchIntensity}</strong>
            <div className="profile-intensity-track">
              <i style={{ width: `${country.researchIntensity}%` }} />
            </div>
            <p className="profile-intensity-explainer">
              <Info size={13} />
              Relative score (0-100) from verified project, institution,
              partner and publication relationships for this country, scaled
              against the most active country in the current dataset. Not an
              official ranking and not a measure of research quality — it
              only reflects observed activity in the extracted data.
            </p>
          </section>

          <div className="profile-stats-row">
            <span>
              <strong>{country.activity?.verifiedProjects ?? countryProjects.length}</strong>{" "}
              verified records
            </span>
            <span>
              <strong>{country.activity?.institutions ?? country.institutions?.length ?? 0}</strong>{" "}
              active hubs
            </span>
          </div>

          <section className="profile-section">
            <h3>
              <Ship size={17} />
              Top Maritime Themes
            </h3>
            <div className="tag-list">
              {country.themes.map((theme) => {
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
          </section>

          <details className="profile-section" open>
            <summary>
              <Building2 size={17} />
              Institutions
            </summary>
            <InstitutionList
              institutions={country.institutions}
              recordCounts={institutionRecordCounts}
            />
          </details>

          <details className="profile-section" open>
            <summary>
              <FlaskConical size={17} />
              Research Records ({countryProjects.length})
            </summary>
            {countryProjects.length ? (
              <ul className="research-record-list">
                {countryProjects
                  .slice(0, RESEARCH_RECORDS_PREVIEW_COUNT)
                  .map((project) => (
                    <ResearchRecordRow key={project.id} project={project} />
                  ))}
              </ul>
            ) : (
              <p className="source-empty">No extracted records yet.</p>
            )}
            <Link
              className="profile-view-all-link"
              to={`/country/${country.slug}#research-records`}
            >
              View all {countryProjects.length} research records
            </Link>
          </details>

          <section className="profile-section insight">
            <h3>
              <BrainCircuit size={17} />
              AI-style Insight
            </h3>
            <p>{country.aiInsight}</p>
          </section>

          <section className="profile-section data">
            <h3>
              <Database size={17} />
              Source / Data Status
            </h3>
            <p>{country.dataStatus}</p>
            <p>Data updated until: {country.dataUpdatedUntil}</p>
          </section>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
