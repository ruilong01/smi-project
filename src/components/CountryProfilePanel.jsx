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
import { useMemo } from "react";
import { getProjectsForCountry } from "../data/researchProjectData.js";
import InstitutionLink from "./InstitutionLink.jsx";
import TopicTag from "./TopicTag.jsx";
import ResearchRecordList from "./ResearchRecordRow.jsx";
import {
  getIntensityColor,
  getIntensityLabel,
} from "../utils/intensity.js";

const RESEARCH_RECORDS_PREVIEW_COUNT = 6;

function InstitutionList({ institutions, recordCounts }) {
  return (
    <ul className="profile-list">
      {institutions.map((name) => (
        <li key={name}>
          <InstitutionLink name={name} />
          {recordCounts.get(name) ? (
            <span className="profile-list-count">
              {recordCounts.get(name)} record
              {recordCounts.get(name) === 1 ? "" : "s"}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export default function CountryProfilePanel({ country, onClose }) {
  const { countryProjects, institutionRecordCounts } = useMemo(() => {
    const projects = country ? getProjectsForCountry(country.name) : [];
    const counts = new Map();
    projects.forEach((project) => {
      if (!project.leadOrganisation) return;
      counts.set(project.leadOrganisation, (counts.get(project.leadOrganisation) ?? 0) + 1);
    });
    return { countryProjects: projects, institutionRecordCounts: counts };
  }, [country]);

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
              Research intensity is a relative score based on the number of
              maritime R&amp;D records, active institutions and topic
              diversity in the current dataset. It is not an official
              national ranking.
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
              {country.themes.map((theme) => (
                <TopicTag category={theme} key={theme} />
              ))}
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
            <ResearchRecordList projects={countryProjects.slice(0, RESEARCH_RECORDS_PREVIEW_COUNT)} />
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
