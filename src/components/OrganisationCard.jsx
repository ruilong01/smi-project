import { Building2 } from "lucide-react";

export default function OrganisationCard({ name, role }) {
  return (
    <article className="organisation-card">
      <span>
        <Building2 size={18} />
      </span>
      <div>
        <p className="eyebrow">{role}</p>
        <h3>{name}</h3>
      </div>
    </article>
  );
}
