import { AnimatePresence, motion } from "framer-motion";
import {
  BrainCircuit,
  Building2,
  Database,
  FlaskConical,
  Info,
  MapPin,
  Ship,
  Sparkles,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useMemo } from "react";
import { getProjectsForCountry } from "../data/researchProjectData.js";
import { getGalleryRecordsForCountryCode } from "../data/researchGalleryData.js";
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
  const galleryRecordsForCountry = useMemo(
    () => (country ? getGalleryRecordsForCountryCode(country.code) : []),
    [country]
  );

  const {
    countryProjects,
    institutionRecordCounts,
    countryEvidence,
    countryImages,
    enrichedCount,
  } = useMemo(() => {
    const projects = country ? getProjectsForCountry(country.name) : [];
    const counts = new Map();
    let enriched = 0;
    projects.forEach((project) => {
      if (!project.leadOrganisation) return;
      counts.set(project.leadOrganisation, (counts.get(project.leadOrganisation) ?? 0) + 1);
    });
    const evidence = [];
    const images = [];
    projects.forEach((project) => {
      if (project.selectedEvidence?.length) {
        enriched += 1;
        evidence.push(
          ...project.selectedEvidence.map((item) => ({ ...item, projectTitle: project.title }))
        );
      }
      (project.sourcePages ?? []).forEach((page) => {
        images.push(...(page.images ?? []));
      });
    });
    return {
      countryProjects: projects,
      institutionRecordCounts: counts,
      countryEvidence: evidence,
      countryImages: images,
      enrichedCount: enriched,
    };
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
            {galleryRecordsForCountry.length ? (
              <Link
                className="profile-view-all-link"
                to={`/research-gallery/${galleryRecordsForCountry[0].recordId}`}
              >
                View in Research Gallery
              </Link>
            ) : null}
          </details>

          {countryEvidence.length ? (
            <details className="profile-section">
              <summary>
                <Sparkles size={17} />
                Evidence ({countryEvidence.length})
              </summary>
              <ul className="evidence-snippet-list">
                {countryEvidence.slice(0, 5).map((evidence) => (
                  <li className="evidence-snippet-card" key={evidence.evidenceId}>
                    <p className="eyebrow">
                      {evidence.evidenceType} · {evidence.projectTitle}
                    </p>
                    <p className="evidence-snippet-text">&ldquo;{evidence.snippet}&rdquo;</p>
                    <p className="evidence-snippet-why">{evidence.whyImportant}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {countryImages.length ? (
            <details className="profile-section">
              <summary>
                <Sparkles size={17} />
                Media ({countryImages.length})
              </summary>
              <p className="source-empty">
                Rights not verified — source preview only, not official images.
              </p>
              <div className="image-candidate-grid">
                {countryImages.slice(0, 6).map((image) => (
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
            <p className="profile-list-count">
              {enrichedCount} of {countryProjects.length} record
              {countryProjects.length === 1 ? "" : "s"} have detailed
              evidence; the rest are metadata-only (title, institution,
              topic, source link).
            </p>
          </section>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
