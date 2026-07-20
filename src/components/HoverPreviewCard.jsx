import { motion } from "framer-motion";
import { ArrowRight, Building2, Gauge } from "lucide-react";
import { Link } from "react-router-dom";
import InstitutionLink from "./InstitutionLink.jsx";
import { getIntensityColor, getIntensityLabel } from "../utils/intensity.js";

function formatDate(isoDate) {
  if (!isoDate) {
    return "unknown";
  }

  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }

  return parsed.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Hover Preview Card (Problem 1). Compact, appears after a short hover
 * delay, never requires a click. Supports two variants:
 *  - country: shown when hovering a country shape or country marker.
 *  - project: shown when hovering a project marker (e.g. the numbered
 *    score marker). Project-level content is used here rather than
 *    fabricating country stats for a single project's marker.
 */
export default function HoverPreviewCard({
  country,
  onMouseEnter,
  onMouseLeave,
  onViewFullProfile,
  position,
  project,
}) {
  if (!country && !project) {
    return null;
  }

  const style = position
    ? { left: `${position.x}px`, top: `${position.y}px` }
    : undefined;

  if (country) {
    const topThemes = (country.themes ?? []).slice(0, 3);
    const records = country.activity?.verifiedProjects ?? 0;
    const hubs = country.activity?.institutions ?? country.institutions?.length ?? 0;
    const lastSynced = country.activity?.lastUpdated ?? country.dataUpdatedUntil;

    return (
      <motion.article
        animate={{ opacity: 1, scale: 1 }}
        className="hover-preview-card"
        exit={{ opacity: 0, scale: 0.97 }}
        initial={{ opacity: 0, scale: 0.97 }}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onPointerDown={(event) => event.stopPropagation()}
        style={style}
        transition={{ duration: 0.15, ease: "easeOut" }}
      >
        <p className="hover-card-eyebrow">Country research preview</p>
        <h3>{country.name}</h3>

        <div className="hover-card-stats">
          <span>
            <strong>{records}</strong> maritime R&amp;D record{records === 1 ? "" : "s"}
          </span>
          <span>
            <strong>{hubs}</strong> active hub{hubs === 1 ? "" : "s"}
          </span>
        </div>

        {topThemes.length ? (
          <div className="hover-card-topics">
            <p className="hover-card-label">Top topics</p>
            <ul>
              {topThemes.map((theme) => (
                <li key={theme}>{theme}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div
          className="hover-card-intensity"
          style={{
            "--country-accent": getIntensityColor(country.researchIntensity, false),
          }}
        >
          <Gauge size={15} />
          <span>
            {getIntensityLabel(country.researchIntensity)} -{" "}
            {country.researchIntensity}/100
          </span>
        </div>

        <p className="hover-card-review">{country.summary}</p>

        <p className="hover-card-updated">
          Last synchronised: {formatDate(lastSynced)}
        </p>

        <button
          className="hover-card-action"
          onClick={onViewFullProfile}
          type="button"
        >
          View Full Profile
          <ArrowRight size={15} />
        </button>
      </motion.article>
    );
  }

  const topTechnologies = (project.technologies ?? project.categories ?? []).slice(0, 3);

  return (
    <motion.article
      animate={{ opacity: 1, scale: 1 }}
      className="hover-preview-card hover-preview-card-project"
      exit={{ opacity: 0, scale: 0.97 }}
      initial={{ opacity: 0, scale: 0.97 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerDown={(event) => event.stopPropagation()}
      style={style}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      <p className="hover-card-eyebrow">Project research preview</p>
      <h3>{project.title}</h3>

      <div className="hover-card-stats">
        <span>
          <Building2 size={14} />
          <InstitutionLink name={project.leadOrganisation} onClick={onMouseLeave} />
        </span>
        <span>{project.country}</span>
      </div>

      {topTechnologies.length ? (
        <div className="hover-card-topics">
          <p className="hover-card-label">Key technologies</p>
          <ul>
            {topTechnologies.map((technology) => (
              <li key={technology}>{technology}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="hover-card-review">
        {project.plainLanguageSummary || project.summary}
      </p>

      <p className="hover-card-updated">
        Last verified: {formatDate(project.lastVerifiedAt || project.lastUpdatedAt)}
      </p>

      <Link
        className="hover-card-action"
        onClick={onMouseLeave}
        to={`/projects/${project.slug}`}
      >
        View Project
        <ArrowRight size={15} />
      </Link>
    </motion.article>
  );
}
