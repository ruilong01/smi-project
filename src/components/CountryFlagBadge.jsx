import { useState } from "react";
import { Globe2 } from "lucide-react";
import { getFlagEmoji } from "../utils/countryFlag.js";

/**
 * Country flag - prefers the real, locally-fetched SVG asset from
 * public/assets/flags/{iso2}.svg (see scripts/ingestion/fetchCountryFlags.mjs)
 * over the Unicode emoji fallback, since a real flag renders identically
 * across every OS/browser (emoji flag glyphs are missing entirely on some
 * platforms, e.g. Windows). No remote flag request is ever made from the
 * browser - only this pre-fetched local asset, or the emoji/globe
 * fallbacks below, all fully offline. If the local file 404s (not fetched
 * yet for that code), falls back to the emoji; with no valid ISO2 at all,
 * falls back to a plain globe icon.
 */
export default function CountryFlagBadge({ countryCode, countryName, size = "md" }) {
  const [localAssetFailed, setLocalAssetFailed] = useState(false);
  const flagEmoji = getFlagEmoji(countryCode);
  const hasValidCode = Boolean(countryCode) && countryCode.length === 2;
  const altText = countryName ? `${countryName} flag` : hasValidCode ? `Flag: ${countryCode}` : "Flag unavailable";
  const pixelSize = size === "lg" ? 24 : 16;

  if (hasValidCode && !localAssetFailed) {
    return (
      <img
        alt={altText}
        className={`country-flag-badge country-flag-badge-${size}`}
        height={pixelSize}
        loading="lazy"
        onError={() => setLocalAssetFailed(true)}
        src={`/assets/flags/${countryCode.toLowerCase()}.svg`}
        width={pixelSize}
      />
    );
  }

  return (
    <span aria-label={altText} className={`country-flag-badge country-flag-badge-${size}`} role="img">
      {flagEmoji ?? <Globe2 aria-hidden="true" size={size === "lg" ? 20 : 13} />}
    </span>
  );
}
