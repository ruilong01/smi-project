import {
  ArrowLeft,
  Building2,
  ExternalLink,
  FlaskConical,
  MapPin,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import {
  getCountryByCode,
  getInstitutionBySlug,
  getLiveDataStatusLabel,
  getProjectsForInstitution,
} from "../data/researchProjectData.js";
import { isValidExternalUrl } from "../utils/url.js";
import ResearchRecordList from "../components/ResearchRecordRow.jsx";

export default function InstitutionDetail() {
  const { slug } = useParams();
  const institution = getInstitutionBySlug(slug);

  if (!institution) {
    return (
      <main className="detail-shell">
        <div className="ocean-grid" aria-hidden="true" />
        <section className="detail-card not-found">
          <p className="eyebrow">No institution found</p>
          <h1>Institution profile unavailable</h1>
          <Link className="back-link" to="/">
            <ArrowLeft size={18} />
            Back to map
          </Link>
        </section>
      </main>
    );
  }

  const country = getCountryByCode(institution.countryCode);
  const { led, partnered } = getProjectsForInstitution(institution);
  const totalRecords = led.length + partnered.length;

  return (
    <main className="detail-shell">
      <div className="ocean-grid" aria-hidden="true" />

      <section className="detail-hero">
        <Link className="back-link" to="/">
          <ArrowLeft size={18} />
          Back to map
        </Link>
        <p className="eyebrow">Institution research profile</p>
        <h1>{institution.canonicalName}</h1>
        <p className="detail-region">
          <MapPin size={15} style={{ display: "inline", verticalAlign: "-2px" }} />{" "}
          {country ? (
            <Link to={`/country/${country.slug}`}>{country.name}</Link>
          ) : (
            institution.countryCode
          )}
          {institution.city ? ` · ${institution.city}` : ""}
        </p>
        <div className="detail-status-pill data-freshness-pill">
          {getLiveDataStatusLabel()}
        </div>
      </section>

      <section className="detail-grid">
        <article className="detail-card">
          <h2>
            <Building2 size={20} />
            Institution
          </h2>
          <dl className="project-at-glance">
            <div className="project-info-item">
              <dt>Type</dt>
              <dd>{institution.institutionType || "Unspecified"}</dd>
            </div>
            <div className="project-info-item">
              <dt>Records (lead)</dt>
              <dd>{led.length}</dd>
            </div>
            <div className="project-info-item">
              <dt>Records (partner)</dt>
              <dd>{partnered.length}</dd>
            </div>
          </dl>
          {institution.website && isValidExternalUrl(institution.website) ? (
            <a
              className="source-link"
              href={institution.website}
              rel="noreferrer"
              target="_blank"
            >
              Visit institution website
              <ExternalLink size={15} />
            </a>
          ) : null}
        </article>

        <article className="detail-card wide">
          <h2>
            <FlaskConical size={20} />
            Research Records as Lead Institution ({led.length})
          </h2>
          <ResearchRecordList
            projects={led}
            showInstitution={false}
            extraLabel="Lead"
            emptyText="No records where this institution leads yet."
          />
        </article>

        <article className="detail-card wide">
          <h2>
            <FlaskConical size={20} />
            Research Records as Partner ({partnered.length})
          </h2>
          <ResearchRecordList
            projects={partnered}
            showInstitution={false}
            extraLabel="Partner"
            emptyText="No records where this institution is a partner yet."
          />
        </article>

        {totalRecords === 0 ? (
          <article className="detail-card wide">
            <p className="source-empty">
              No extracted research records reference this institution yet.
            </p>
          </article>
        ) : null}
      </section>
    </main>
  );
}
