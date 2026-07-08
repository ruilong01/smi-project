export const websiteSourceConfig = [
  {
    group: "Singapore and maritime sources",
    adapterType: "officialWebsite",
    sources: [
      "Maritime and Port Authority of Singapore",
      "Singapore Maritime Institute",
      "IMO NextGEN",
      "IMO Future Fuels and Technology",
      "CORDIS",
      "Waterborne Technology Platform",
      "IAPH World Ports Sustainability Program",
      "Global Centre for Maritime Decarbonisation",
      "European Maritime Safety Agency",
    ],
  },
  {
    group: "Academic sources",
    adapterType: "academicMetadata",
    sources: ["OpenAlex", "Crossref", "Semantic Scholar", "arXiv"],
  },
  {
    group: "Patent sources",
    adapterType: "patentMetadata",
    sources: [
      "European Patent Office Open Patent Services",
      "Espacenet",
      "WIPO PATENTSCOPE",
    ],
  },
  {
    group: "Organisation and location sources",
    adapterType: "entityResolution",
    sources: [
      "Research Organization Registry",
      "Wikidata",
      "OpenStreetMap",
      "Nominatim",
    ],
  },
  {
    group: "Image sources",
    adapterType: "licensedMediaLookup",
    sources: [
      "Wikimedia Commons",
      "Official project websites",
      "Official university and organisation media pages",
    ],
  },
  {
    group: "Classification societies",
    adapterType: "classificationSociety",
    sources: [
      "DNV",
      "American Bureau of Shipping",
      "Lloyd's Register",
      "Bureau Veritas",
      "ClassNK",
      "RINA",
    ],
  },
  {
    group: "Supporting maritime news",
    adapterType: "supportingNews",
    sources: [
      "The Maritime Executive",
      "gCaptain",
      "MarineLink",
      "Splash247",
      "Offshore Energy",
    ],
  },
];

export const mockProjectSourceAdapter = {
  name: "mockProjectSourceAdapter",
  mode: "configuration-only",
  description:
    "Placeholder adapter contract for future API-backed source collection. This MVP does not scrape or fetch external websites.",
  fetchProjectCandidates: async () => [],
};
