import { Building2, ExternalLink, ImageOff } from "lucide-react";
import { Link } from "react-router-dom";
import CountryFlagBadge from "./CountryFlagBadge.jsx";
import { getInstitutionImage } from "../data/institutionImageRegistry.js";

/**
 * Institution identity block: name, country + flag, and an image state.
 *
 * Only an EXACT slug or exact normalized-name match against
 * institutionImageRegistry.js ever shows a real image - no fuzzy matching,
 * so NTU's image can never attach to another Singapore institution just
 * because they share a country. Everything else still renders the honest
 * "pending" state rather than a fake building photo or an unrelated
 * stock/campus image.
 */
export default function InstitutionHeader({ institution, country, slug }) {
  const image = getInstitutionImage({ slug, name: institution.canonicalName });

  return (
    <div className="institution-header">
      {image ? (
        <figure className="institution-image-figure">
          <img alt={institution.canonicalName} className="institution-image" src={image.assetPath} />
          <figcaption>
            <a href={image.imageSourceUrl} rel="noreferrer" target="_blank">
              {image.imageSourceName || "Official source"}
              <ExternalLink aria-hidden="true" size={11} />
            </a>
            <span className="institution-image-rights" title={image.rightsNote}>
              {image.rightsNote}
            </span>
          </figcaption>
        </figure>
      ) : (
        <div className="institution-image-pending">
          <Building2 aria-hidden="true" size={28} />
          <span>
            <ImageOff aria-hidden="true" size={13} />
            Institution image pending source verification
          </span>
        </div>
      )}
      <div className="institution-header-copy">
        <h1>{institution.canonicalName}</h1>
        <p className="detail-region">
          <CountryFlagBadge countryCode={institution.countryCode} countryName={country?.name} />{" "}
          {country ? <Link to={`/country/${country.slug}`}>{country.name}</Link> : institution.countryCode}
          {institution.city ? ` · ${institution.city}` : ""}
        </p>
      </div>
    </div>
  );
}
