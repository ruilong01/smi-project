import { motion } from "framer-motion";
import { ArrowRight, Gauge, X } from "lucide-react";
import { Link } from "react-router-dom";
import { getTopicSlug } from "../data/topicData.js";
import {
  getIntensityColor,
  getIntensityLabel,
} from "../utils/intensity.js";

export default function CountryPopup({
  country,
  onClose,
  onInteractionEnd,
  onInteractionStart,
  onViewProfile,
  position,
}) {
  if (!country) {
    return null;
  }

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

  function viewFullProfile() {
    onViewProfile(country);
  }

  return (
    <motion.article
      animate={{ opacity: 1, scale: 1 }}
      className="country-popup"
      exit={{ opacity: 0, scale: 0.98 }}
      initial={{ opacity: 0, scale: 0.98 }}
      onMouseEnter={onInteractionStart}
      onMouseLeave={onInteractionEnd}
      onPointerDown={(event) => event.stopPropagation()}
      style={popupStyle}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <button
        aria-label="Close country popup"
        className="popup-close"
        onClick={closePopup}
        type="button"
      >
        <X size={16} />
      </button>

      <p className="eyebrow">Country snapshot</p>
      <h2>{country.name}</h2>

      <div
        className="popup-intensity"
        style={{
          "--country-accent": getIntensityColor(country.researchIntensity, false),
        }}
      >
        <Gauge size={18} />
        <span>
          {getIntensityLabel(country.researchIntensity)} -{" "}
          {country.researchIntensity}/100
        </span>
      </div>

      <p>{country.summary}</p>

      <div className="popup-themes">
        {country.themes.map((theme) => (
          <Link
            className="popup-term-static topic-link"
            key={theme}
            onClick={onInteractionEnd}
            to={`/topic/${getTopicSlug(theme)}`}
          >
            {theme}
          </Link>
        ))}
      </div>

      <p className="popup-updated">
        Data updated until: {country.dataUpdatedUntil}
      </p>

      <button
        className="popup-details-button"
        onClick={viewFullProfile}
        type="button"
      >
        View Full Profile
        <ArrowRight size={17} />
      </button>
    </motion.article>
  );
}
