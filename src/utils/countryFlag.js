// Converts a 2-letter ISO country code into its Unicode regional-indicator
// flag emoji (e.g. "SG" -> "🇸🇬"). Rendered entirely by the OS/browser's own
// font - no network fetch, no third-party flag image service, so there is
// nothing that can ever resolve to a random/wrong image.
export function getFlagEmoji(countryCode) {
  if (!countryCode || typeof countryCode !== "string" || countryCode.length !== 2) {
    return null;
  }
  const upper = countryCode.toUpperCase();
  const codePoints = [...upper].map((char) => 127397 + char.charCodeAt(0));
  if (codePoints.some((point) => point < 127462 || point > 127487)) {
    return null;
  }
  return String.fromCodePoint(...codePoints);
}
