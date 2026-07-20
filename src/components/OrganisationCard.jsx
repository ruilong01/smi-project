import { Building2 } from "lucide-react";
import { Link } from "react-router-dom";

export default function OrganisationCard({ name, role, slug }) {
  return (
    <article className="organisation-card">
      <span>
        <Building2 size={18} />
      </span>
      <div>
        <p className="eyebrow">{role}</p>
        {slug ? (
          <h3>
            <Link className="institution-link" to={`/institution/${slug}`}>
              {name}
            </Link>
          </h3>
        ) : (
          <h3>{name}</h3>
        )}
      </div>
    </article>
  );
}
