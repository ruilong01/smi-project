import { useState } from "react";

/**
 * A record's image, or nothing at all - this component is only ever meant
 * to be used where an image is already known to exist (ResearchRecordCard,
 * research detail heroes). It never renders an "image not available"
 * placeholder itself; callers that might have no image should not render
 * this component in the first place (see EnrichmentPendingNotice).
 *
 * `variant="thumbnail"` is the small card-list size; `variant="hero"` is
 * the large research-detail-page size.
 */
export default function ResearchImagePreview({ imageUrl, altText, caption, variant = "thumbnail" }) {
  const [failed, setFailed] = useState(false);

  if (!imageUrl || failed) {
    return null;
  }

  if (variant === "hero") {
    return (
      <figure className="project-hero-image">
        <img alt={altText || caption || "Research record image"} onError={() => setFailed(true)} src={imageUrl} />
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
    );
  }

  return (
    <img
      alt={altText || caption || ""}
      className="research-record-image-thumb"
      loading="lazy"
      onError={() => setFailed(true)}
      src={imageUrl}
    />
  );
}
