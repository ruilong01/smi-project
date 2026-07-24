import { ArrowLeft, ExternalLink, FlaskConical } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import {
  filterImageReadyProjects,
  getCountryByCode,
  getInstitutionBySlug,
  getLiveDataStatusLabel,
  getProjectsForInstitution,
  toResearchRecordCardProps,
} from "../data/researchProjectData.js";
import {
  getGalleryRecordsForInstitutionName,
  isGalleryRecordCoordinatedBy,
  toGalleryCardProps,
} from "../data/researchGalleryData.js";
import { isValidExternalUrl } from "../utils/url.js";
import { dedupeRecordCardsByTitle } from "../utils/dedupeRecordCards.js";
import InstitutionHeader from "../components/InstitutionHeader.jsx";
import DataStatusBadge from "../components/DataStatusBadge.jsx";
import EnrichmentPendingNotice from "../components/EnrichmentPendingNotice.jsx";
import { ResearchRecordCardList } from "../components/ResearchRecordCard.jsx";

function ResearchRecordSection({ title, totalCount, cards }) {
  return (
    <article className="detail-card wide">
      <h2>
        <FlaskConical size={20} />
        {title} ({totalCount})
      </h2>
      {cards.length ? (
        <ResearchRecordCardList records={cards} />
      ) : totalCount > 0 ? (
        <EnrichmentPendingNotice pendingCount={totalCount} />
      ) : (
        <p className="source-empty">No extracted research records in this role yet.</p>
      )}
    </article>
  );
}

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

  const galleryMatches = getGalleryRecordsForInstitutionName(institution.canonicalName);
  const galleryLead = galleryMatches.filter((record) => isGalleryRecordCoordinatedBy(record, institution.canonicalName));
  const galleryPartner = galleryMatches.filter((record) => !isGalleryRecordCoordinatedBy(record, institution.canonicalName));

  const ledCards = dedupeRecordCardsByTitle([
    ...galleryLead.map(toGalleryCardProps),
    ...filterImageReadyProjects(led).map(toResearchRecordCardProps),
  ]);
  const partnerCards = dedupeRecordCardsByTitle([
    ...galleryPartner.map(toGalleryCardProps),
    ...filterImageReadyProjects(partnered).map(toResearchRecordCardProps),
  ]);
  const totalLedCount = led.length + galleryLead.length;
  const totalPartnerCount = partnered.length + galleryPartner.length;

  return (
    <main className="detail-shell">
      <div className="ocean-grid" aria-hidden="true" />

      <section className="detail-hero">
        <Link className="back-link" to="/">
          <ArrowLeft size={18} />
          Back to map
        </Link>
        <p className="eyebrow">Institution research profile</p>
        <InstitutionHeader country={country} institution={institution} />
        <DataStatusBadge label={getLiveDataStatusLabel()} />
      </section>

      <section className="detail-grid">
        <article className="detail-card">
          <h2>Institution</h2>
          <dl className="project-at-glance">
            <div className="project-info-item">
              <dt>Type</dt>
              <dd>{institution.institutionType || "Unspecified"}</dd>
            </div>
            <div className="project-info-item">
              <dt>Records (lead)</dt>
              <dd>
                {totalLedCount} <span className="profile-list-count">({ledCards.length} image-ready)</span>
              </dd>
            </div>
            <div className="project-info-item">
              <dt>Records (partner)</dt>
              <dd>
                {totalPartnerCount} <span className="profile-list-count">({partnerCards.length} image-ready)</span>
              </dd>
            </div>
          </dl>
          {institution.website && isValidExternalUrl(institution.website) ? (
            <a className="source-link" href={institution.website} rel="noreferrer" target="_blank">
              Visit institution website
              <ExternalLink size={15} />
            </a>
          ) : null}
        </article>

        <ResearchRecordSection cards={ledCards} title="Research Records as Lead Institution" totalCount={totalLedCount} />
        <ResearchRecordSection cards={partnerCards} title="Research Records as Partner" totalCount={totalPartnerCount} />

        {totalRecords === 0 && galleryMatches.length === 0 ? (
          <article className="detail-card wide">
            <p className="source-empty">No extracted research records reference this institution yet.</p>
          </article>
        ) : null}
      </section>
    </main>
  );
}
