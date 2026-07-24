import { ShieldCheck } from "lucide-react";

/**
 * Small label naming where a record's data/verification status comes from -
 * e.g. "Source-linked seed record" or "OpenAlex API". Used anywhere a
 * research card needs to show its provenance without repeating the full
 * verification-status prose inline.
 */
export default function ProvenanceBadge({ label }) {
  if (!label) {
    return null;
  }

  return (
    <span className="provenance-badge">
      <ShieldCheck aria-hidden="true" size={12} />
      {label}
    </span>
  );
}
