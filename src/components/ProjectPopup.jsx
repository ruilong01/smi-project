import { motion } from "framer-motion";
import { ArrowRight, Database, MapPin, ShieldCheck, X } from "lucide-react";
import { Link } from "react-router-dom";
import { getInstitutionSlugForName } from "../data/researchProjectData.js";
import { getSourcesForProject } from "../data/sourceRegistry.js";

function getSourceIndicator(sources) {
  const hasPrimary = sources.some((source) => source.primaryOrSecondary === "primary");
  const officialCount = sources.filter((source) =>
    ["A", "B", "D"].includes(source.authorityLevel)
  ).length;

  if (hasPrimary && officialCount > 1) {
    return "Official sources";
  }

  if (hasPrimary) {
    return "Primary source";
  }

  return "Supporting sources";
}

export default function ProjectPopup({
  project,
  onClose,
  onInteractionEnd,
  onInteractionStart,
  position,
}) {
  if (!project) {
    return null;
  }

  const sources = getSourcesForProject(project);
  const institutionSlug = getInstitutionSlugForName(project.leadOrganisation);
  const popupStyle = position
    ? {
        left: `${position.x}%`,
        top: `${position.y}%`,
      }
    : undefined;

  function closePopup() {
    onClose();
    onInteractionEnd();
  }

  return (
    <motion.article
      animate={{ opacity: 1, scale: 1 }}
      className={`project-popup marker-popup marker-${project.displayTier}`}
      exit={{ opacity: 0, scale: 0.98 }}
      initial={{ opacity: 0, scale: 0.98 }}
      onMouseEnter={onInteractionStart}
      onMouseLeave={onInteractionEnd}
      onPointerDown={(event) => event.stopPropagation()}
      style={popupStyle}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <button
        aria-label="Close project popup"
        className="popup-close"
        onClick={closePopup}
        type="button"
      >
        <X size={16} />
      </button>

      <p className="eyebrow">Research project</p>
      <h2>{project.title}</h2>

      <div className="project-popup-meta">
        <span>
          <MapPin size={14} />
          {project.city ? `${project.city}, ${project.country}` : project.country}
        </span>
        <span>{project.researchCategories[0]}</span>
        <span>{project.projectStatus}</span>
        <span>Verified {project.lastVerifiedDate}</span>
      </div>

      <section className="popup-evidence-block">
        <h3>Lead organisation</h3>
        {institutionSlug ? (
          <Link
            className="institution-link"
            onClick={onInteractionEnd}
            to={`/institution/${institutionSlug}`}
          >
            {project.leadOrganisation}
          </Link>
        ) : (
          <p>{project.leadOrganisation}</p>
        )}
      </section>

      <section className="popup-evidence-block">
        <h3>Why it matters</h3>
        <p>{project.plainLanguageSummary}</p>
      </section>

      <section className="popup-evidence-block why-shown">
        <h3>
          <ShieldCheck size={15} />
          Why this is shown
        </h3>
        <ul>
          {project.displayReasonsText.slice(0, 3).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      </section>

      <div className="project-source-summary">
        <span>
          <Database size={15} />
          {getSourceIndicator(sources)}
        </span>
        <span>{sources.length} supporting sources</span>
      </div>

      <Link
        className="popup-details-button"
        onClick={onInteractionEnd}
        to={`/projects/${project.slug}`}
      >
        More
        <ArrowRight size={17} />
      </Link>
    </motion.article>
  );
}
