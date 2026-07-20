import { Link } from "react-router-dom";
import { getInstitutionSlugForName } from "../data/researchProjectData.js";

/**
 * An institution name that links to /institution/:slug when a matching
 * institution record exists, or renders as plain text otherwise (a
 * category/partner name with no resolvable institution should never be a
 * dead link).
 */
export default function InstitutionLink({ name, className = "institution-link", onClick }) {
  const slug = getInstitutionSlugForName(name);

  if (!slug) {
    return name;
  }

  return (
    <Link className={className} onClick={onClick} to={`/institution/${slug}`}>
      {name}
    </Link>
  );
}
