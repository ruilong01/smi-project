import { ExternalLink } from "lucide-react";
import { SOURCE_AUTHORITY_LEVELS } from "../data/sourceRegistry.js";
import { isValidExternalUrl } from "../utils/url.js";

export default function SourceCard({ source }) {
  const sourceUrlIsValid = isValidExternalUrl(source.url);
  const retrievedAt = source.retrievedAt ?? source.retrievalDate;
  const supportedFields = source.supportedProjectFields ?? [];

  return (
    <article className="source-card">
      <div>
        <p className="eyebrow">
          Level {source.authorityLevel} - {source.primaryOrSecondary}
        </p>
        <h3>{source.title}</h3>
        <p>{source.publisher}</p>
      </div>

      <dl className="source-meta">
        <div>
          <dt>Authority</dt>
          <dd>{SOURCE_AUTHORITY_LEVELS[source.authorityLevel] ?? "Configured source"}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>{source.publicationDate ?? "Not published"}</dd>
        </div>
        <div>
          <dt>Retrieved</dt>
          <dd>{retrievedAt ?? "Not recorded"}</dd>
        </div>
        <div>
          <dt>Reliability</dt>
          <dd>{source.reliabilityScore ?? source.confidence ?? "n/a"}/100</dd>
        </div>
      </dl>

      <div className="source-supported-fields">
        {supportedFields.map((field) => (
          <span key={field}>{field}</span>
        ))}
      </div>

      {sourceUrlIsValid ? (
        <a
          className="source-link"
          href={source.url}
          rel="noreferrer"
          target="_blank"
        >
          Open original source
          <ExternalLink size={15} />
        </a>
      ) : (
        <p className="source-empty">Source URL failed validation.</p>
      )}
    </article>
  );
}
