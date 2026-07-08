import { AnimatePresence, motion } from "framer-motion";
import { BrainCircuit, Building2, Database, FlaskConical, MapPin, Ship, X } from "lucide-react";
import { Link } from "react-router-dom";
import { getTopicSlug } from "../data/topicData.js";
import {
  getIntensityColor,
  getIntensityLabel,
} from "../utils/intensity.js";

function CompactList({ items }) {
  return (
    <ul className="profile-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

export default function CountryProfilePanel({ country, onClose }) {
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
          </section>

          <section className="profile-section">
            <h3>
              <Ship size={17} />
              Top Maritime Themes
            </h3>
            <div className="tag-list">
              {country.themes.map((theme) => (
                <Link
                  className="tag topic-link"
                  key={theme}
                  to={`/topic/${getTopicSlug(theme)}`}
                >
                  {theme}
                </Link>
              ))}
            </div>
          </section>

          <details className="profile-section" open>
            <summary>
              <Building2 size={17} />
              Institutions
            </summary>
            <CompactList items={country.institutions} />
          </details>

          <details className="profile-section">
            <summary>
              <FlaskConical size={17} />
              Example Projects
            </summary>
            <CompactList items={country.exampleProjects} />
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
