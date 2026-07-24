import { Building2, ImageOff } from "lucide-react";
import { Link } from "react-router-dom";
import CountryFlagBadge from "./CountryFlagBadge.jsx";

/**
 * Institution identity block: name, country + flag, and an image state.
 * No institution photo/logo has been source-verified anywhere in the
 * current dataset, so this always renders the honest "pending" state
 * rather than a fake building photo or an unrelated stock/campus image -
 * see docs/PRODUCT_JOURNEY.md. If a source-proven institution image is
 * ever added to the data, render it here with its source/provenance
 * instead of this placeholder.
 */
export default function InstitutionHeader({ institution, country }) {
  return (
    <div className="institution-header">
      <div className="institution-image-pending">
        <Building2 aria-hidden="true" size={28} />
        <span>
          <ImageOff aria-hidden="true" size={13} />
          Institution image pending source verification
        </span>
      </div>
      <div className="institution-header-copy">
        <h1>{institution.canonicalName}</h1>
        <p className="detail-region">
          <CountryFlagBadge countryCode={institution.countryCode} />{" "}
          {country ? <Link to={`/country/${country.slug}`}>{country.name}</Link> : institution.countryCode}
          {institution.city ? ` · ${institution.city}` : ""}
        </p>
      </div>
    </div>
  );
}
