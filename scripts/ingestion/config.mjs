// Never hardcode a real contact address here - this file is committed to
// git. Set OPENALEX_EMAIL in the server's environment (.env, not
// committed) to identify real requests; falls back to a placeholder that
// still works but gets deprioritised by OpenAlex's polite pool.
export const OPENALEX_EMAIL = process.env.OPENALEX_EMAIL || "research-demo@example.invalid";

export const INGESTION_USER_AGENT = `GlobalMaritimeResearchIntelligenceMap/0.3 (contact: ${OPENALEX_EMAIL})`;

export const TEST_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

// Raw collection window: nothing older than this is fetched at all.
export const RAW_COLLECTION_FROM_DATE = "2015-01-01";
// Default display/scoring window (frontend recency scoring, not a fetch filter).
export const DEFAULT_DISPLAY_FROM_DATE = "2020-01-01";
// "Latest highlight" window (frontend recency scoring, not a fetch filter).
export const LATEST_HIGHLIGHT_FROM_DATE = "2024-01-01";

// Dedicated topic list for the server-side refresh pipeline
// (scripts/ingestion/fetchOpenAlex.mjs) - kept separate from the legacy
// MARITIME_QUERIES below (used by the older sync:data/openalex.adapter.mjs
// path) so extending topic coverage here can't regress that pipeline.
export const OPENALEX_TOPIC_QUERIES = [
  "green shipping decarbonisation vessel",
  "smart port digital twin automation",
  "maritime artificial intelligence",
  "autonomous vessel unmanned surface ship",
  "alternative marine fuel ammonia hydrogen methanol",
  "maritime cybersecurity port infrastructure",
  "maritime logistics supply chain port",
  "ship design engineering naval architecture",
  "port decarbonisation emissions maritime",
  "marine robotics underwater vehicle",
  "offshore ocean technology renewable energy",
];

// Records matching one of these terms are excluded even if they otherwise
// pass isStrongMaritimeMatch - near-miss false positives observed in
// earlier OpenAlex searches (e.g. "shipping" as in software/package
// delivery, not maritime transport).
export const OPENALEX_EXCLUDE_TERMS = [
  "postal service",
  "postal delivery",
  "parcel delivery",
  "e-commerce shipping",
  "software as a service",
  "drop shipping",
];

export const MARITIME_QUERIES = [
  "maritime autonomous vessel navigation",
  "smart port digital twin",
  "green shipping alternative marine fuel",
  "maritime cybersecurity port",
  "vessel electrification maritime",
  "maritime artificial intelligence route optimization",
  "port automation logistics maritime supply chain",
  "ammonia fuel maritime shipping vessel",
  "hydrogen powered vessel maritime",
  "unmanned surface vessel maritime autonomous",
  "port digital twin simulation maritime",
  "vessel machine learning maritime navigation",
  "maritime cyber risk port infrastructure",
  "methanol marine fuel shipping vessel",
  "terminal automation smart port maritime",
  "ship emissions vessel efficiency maritime",
  "maritime supply chain logistics port digital",
  "collision avoidance autonomous ship maritime",
  "maritime data exchange communications vessel",
  "port bunkering alternative fuel maritime",
  "maritime artificial intelligence port operations",
  "autonomous ship navigation maritime safety",
  "green shipping decarbonisation vessel maritime",
  "smart shipping digital twin port maritime",
];

export const COUNTRY_ATLAS_NAMES = {
  AU: "Australia",
  BE: "Belgium",
  BR: "Brazil",
  CA: "Canada",
  CN: "China",
  DE: "Germany",
  DK: "Denmark",
  ES: "Spain",
  FI: "Finland",
  FR: "France",
  GB: "United Kingdom",
  GR: "Greece",
  ID: "Indonesia",
  IN: "India",
  IS: "Iceland",
  IT: "Italy",
  JP: "Japan",
  KR: "South Korea",
  MY: "Malaysia",
  NL: "Netherlands",
  NO: "Norway",
  PH: "Philippines",
  SE: "Sweden",
  SG: "Singapore",
  US: "United States of America",
  ZA: "South Africa",
};

export const COUNTRY_COORDINATES = {
  AU: [133.7751, -25.2744],
  BE: [4.4699, 50.5039],
  BR: [-51.9253, -14.235],
  CA: [-106.3468, 56.1304],
  CN: [104.1954, 35.8617],
  DE: [10.4515, 51.1657],
  DK: [9.5018, 56.2639],
  ES: [-3.7492, 40.4637],
  FI: [25.7482, 61.9241],
  FR: [2.2137, 46.2276],
  GB: [-3.436, 55.3781],
  GR: [21.8243, 39.0742],
  ID: [113.9213, -0.7893],
  IN: [78.9629, 20.5937],
  IS: [-19.0208, 64.9631],
  IT: [12.5674, 41.8719],
  JP: [138.2529, 36.2048],
  KR: [127.7669, 35.9078],
  MY: [101.9758, 4.2105],
  NL: [5.2913, 52.1326],
  NO: [8.4689, 60.472],
  PH: [121.774, 12.8797],
  SE: [18.6435, 60.1282],
  SG: [103.8198, 1.3521],
  US: [-98.5795, 39.8283],
  ZA: [22.9375, -30.5595],
};

export const COUNTRY_NAMES = {
  AU: "Australia",
  BE: "Belgium",
  BR: "Brazil",
  CA: "Canada",
  CN: "China",
  DE: "Germany",
  DK: "Denmark",
  ES: "Spain",
  FI: "Finland",
  FR: "France",
  GB: "United Kingdom",
  GR: "Greece",
  ID: "Indonesia",
  IN: "India",
  IS: "Iceland",
  IT: "Italy",
  JP: "Japan",
  KR: "South Korea",
  MY: "Malaysia",
  NL: "Netherlands",
  NO: "Norway",
  PH: "Philippines",
  SE: "Sweden",
  SG: "Singapore",
  US: "United States",
  ZA: "South Africa",
};

export const MPA_SOURCES = [
  "https://www.mpa.gov.sg/maritime-singapore/innovation-and-r-d",
  "https://www.mpa.gov.sg/maritime-singapore/innovation-and-r-d/programmes-and-projects",
];
