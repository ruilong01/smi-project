import { fetchJson, delayMs } from "../http.mjs";
import { hashContent, slugify } from "../normalization.mjs";

export async function verifyCrossrefDoi(doi, nowIso) {
  if (!doi) {
    return null;
  }

  try {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const payload = await fetchJson(url, {
      fetchOptions: {
        email: "research-demo@example.invalid",
        retries: 4,
        timeout: 30000,
        requestDelay: 500, // Crossref polite pool recommends delays
      },
    });

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
  } catch (error) {
    console.warn(`Failed to verify Crossref DOI ${doi}: ${error.message}`);
    return null;
  }
}
