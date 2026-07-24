import { ImageOff } from "lucide-react";

/**
 * Shown instead of a normal research-record card list when records exist
 * but none are image/source-ready yet. This is the one place that message
 * is worded, so country pages, institution pages and the research detail
 * page can never each invent their own version of it.
 */
export default function EnrichmentPendingNotice({ pendingCount }) {
  return (
    <p className="enrichment-pending-notice">
      <ImageOff aria-hidden="true" size={16} />
      Research records are pending image/source enrichment
      {pendingCount ? ` (${pendingCount} record${pendingCount === 1 ? "" : "s"})` : ""}.
    </p>
  );
}
