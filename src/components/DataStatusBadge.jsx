/**
 * Data status / last-synchronised label, shared by the map dashboard,
 * country pages and institution pages so "when was this last updated" is
 * always presented the same way.
 */
export default function DataStatusBadge({ label }) {
  if (!label) {
    return null;
  }

  return <div className="detail-status-pill data-freshness-pill">{label}</div>;
}
