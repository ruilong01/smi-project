import { Link } from "react-router-dom";
import ResearchImagePreview from "./ResearchImagePreview.jsx";
import ProvenanceBadge from "./ProvenanceBadge.jsx";
import { getTopicSlug } from "../data/topicData.js";

/**
 * Real-data research card used on country and institution pages - the main
 * user journey, not just the Research Gallery. Only ever rendered for
 * image-ready records; callers filter their record list down to that
 * before mapping over it (see researchProjectData.js's
 * filterImageReadyProjects / researchGalleryData.js's
 * getGalleryRecordsForCountryCode & getGalleryRecordsForInstitutionName).
 *
 * `topicName` (when given) must be a real topic name from src/data/topicData.js
 * (e.g. "Alternative Fuels"), not a raw research category - the card looks
 * up its own slug rather than relying on the legacy category reverse-lookup
 * TopicTag uses, since gallery records already carry a topic name directly.
 */
export default function ResearchRecordCard({
  href,
  title,
  imageUrl,
  imageAlt,
  imageCaption,
  topicName,
  institutionLabel,
  provenanceLabel,
  actionabilityScore,
}) {
  const topicSlug = topicName ? getTopicSlug(topicName) : undefined;

  return (
    <li className="research-record-card">
      <Link className="research-record-card-image" to={href}>
        <ResearchImagePreview altText={imageAlt} caption={imageCaption} imageUrl={imageUrl} variant="thumbnail" />
      </Link>
      <div className="research-record-card-body">
        <Link className="research-record-title" to={href}>
          {title}
        </Link>
        <div className="research-record-meta">
          {institutionLabel ? <span>{institutionLabel}</span> : null}
          {actionabilityScore != null ? <span>Actionability {actionabilityScore}/100</span> : null}
        </div>
        <div className="research-record-card-footer">
          {topicName ? (
            topicSlug ? (
              <Link className="tag topic-link research-record-topic" to={`/topic/${topicSlug}`}>
                {topicName}
              </Link>
            ) : (
              <span className="tag research-record-topic">{topicName}</span>
            )
          ) : null}
          <ProvenanceBadge label={provenanceLabel} />
        </div>
      </div>
    </li>
  );
}

export function ResearchRecordCardList({ records }) {
  if (!records?.length) {
    return null;
  }

  return (
    <ul className="research-record-card-list">
      {records.map((record) => (
        <ResearchRecordCard key={record.id} {...record} />
      ))}
    </ul>
  );
}
