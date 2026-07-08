import { fetchJson } from "../http.mjs";
import { hashContent, slugify } from "../normalization.mjs";

export async function verifyCrossrefDoi(doi, nowIso) {
  if (!doi) {
    return null;
  }

  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const payload = await fetchJson(url);
  const item = payload.message;

  return {
    source: {
      id: `source-crossref-${slugify(doi)}`,
      publisher: "Crossref",
      title: `Crossref DOI metadata for ${item.title?.[0] ?? doi}`,
      url: item.URL ?? `https://doi.org/${doi}`,
      sourceType: "api",
      authorityLevel: "C",
      primaryOrSecondary: "secondary",
      publicationDate:
        item.published?.["date-parts"]?.[0]?.filter(Boolean).join("-") ?? "",
      retrievedAt: nowIso,
      contentHash: hashContent(JSON.stringify(item)),
      licence: item.license?.[0]?.URL ?? "Crossref metadata",
      extractionMethod: "Crossref API",
      supportedProjectFields: ["researchOutputs", "publicationDate", "publisher"],
      reliabilityScore: 80,
    },
    metadata: item,
  };
}
