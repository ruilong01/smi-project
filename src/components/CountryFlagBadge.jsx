import { Globe2 } from "lucide-react";
import { getFlagEmoji } from "../utils/countryFlag.js";

/**
 * Country flag rendered as a Unicode emoji from the ISO country code - no
 * fetch, no third-party image, so it can never resolve to the wrong/random
 * flag. Falls back to a plain globe icon when no valid code is available.
 */
export default function CountryFlagBadge({ countryCode, size = "md" }) {
  const flag = getFlagEmoji(countryCode);

  return (
    <span
      aria-label={flag ? `Flag: ${countryCode}` : "Flag unavailable"}
      className={`country-flag-badge country-flag-badge-${size}`}
      role="img"
    >
      {flag ?? <Globe2 aria-hidden="true" size={size === "lg" ? 20 : 13} />}
    </span>
  );
}
