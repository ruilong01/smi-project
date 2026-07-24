import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

// Backend API base for the in-app PDF reader (see docs/IN_APP_PDF_READER.md).
// The rest of the frontend still reads data/processed/*.json via build-time
// import (goal tracker item 7) - this is the first runtime fetch() call to
// server/server.mjs, scoped only to this component so it doesn't disturb
// that seam.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8787";

/**
 * Renders nothing until the backend confirms an approved, in-app-viewable
 * PDF exists for this record (matches CLAUDE.md's "hide empty sections"
 * convention - no "no PDF available" clutter on the ~321 records that
 * don't have one yet).
 */
export default function PdfViewer({ recordId }) {
  const [meta, setMeta] = useState(null);

  useEffect(() => {
    if (!recordId) {
      setMeta(null);
      return;
    }
    let cancelled = false;
    setMeta(null);
    fetch(`${API_BASE}/api/research-records/${encodeURIComponent(recordId)}/pdf-meta`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setMeta(data?.available ? data : null);
      })
      .catch(() => {
        if (!cancelled) setMeta(null);
      });
    return () => {
      cancelled = true;
    };
  }, [recordId]);

  if (!meta) {
    return null;
  }

  const pdfUrl = `${API_BASE}/api/research-records/${encodeURIComponent(recordId)}/pdf`;

  return (
    <article className="detail-card wide pdf-viewer-card">
      <h2>Full Paper PDF</h2>
      <p className="source-empty">
        {meta.sourceName ? `Open-access copy via ${meta.sourceName}.` : "Open-access copy."}
        {meta.license ? ` License: ${meta.license}.` : ""}
      </p>
      <div className="pdf-viewer-frame-wrap">
        <iframe className="pdf-viewer-frame" src={pdfUrl} title={`Full paper PDF: ${meta.title || "research paper"}`} />
      </div>
      {meta.allowUserDownload ? (
        <a className="gallery-open-source" href={pdfUrl} rel="noreferrer" target="_blank">
          Download PDF
          <ExternalLink size={14} aria-hidden="true" />
        </a>
      ) : null}
    </article>
  );
}
