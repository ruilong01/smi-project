import { MPA_SOURCES } from "../config.mjs";
import { fetchText, delayMs } from "../http.mjs";
import {
  classifyText,
  detectTechnologies,
  firstSentence,
  hashContent,
  slugify,
} from "../normalization.mjs";

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTitle(html, fallback) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? stripHtml(match[1]) : fallback;
}

export async function fetchMpaOfficialRecords(nowIso) {
  const records = [];
  const errors = [];
  const REQUEST_DELAY_MS = 2000; // 2 second delay between website requests

  for (const url of MPA_SOURCES) {
    try {
      console.log(`  Fetching MPA source: ${url}`);
      
      const html = await fetchText(url, {
        fetchOptions: {
          email: "research-demo@example.invalid",
          retries: 4,
          timeout: 30000,
          requestDelay: REQUEST_DELAY_MS,
        },
      });

      const text = stripHtml(html);
      const title = getTitle(html, "MPA Maritime Singapore Innovation and R&D");
      const sourceId = `source-mpa-${slugify(url)}`;
      const projectId = `project-mpa-${slugify(title)}`;
      const categories = classifyText(`${title} ${text}`);
      const technologies = detectTechnologies(`${title} ${text}`);

      records.push({
        project: {
          id: projectId,
          slug: slugify(title),
          title,
          alternateTitles: [],
          summary: firstSentence(
            text,
            "Official Maritime and Port Authority of Singapore innovation and R&D page."
          ),
          technicalDescription: firstSentence(text, "Official MPA R&D information."),
          projectType: "POLICY_OR_ROADMAP",
          entityType: "POLICY_OR_ROADMAP",
          status: "Official source page",
          projectStatus: "Official source page",
          startDate: "",
          endDate: "",
          categories: categories.length ? categories : ["Intelligent port services"],
          researchCategories: categories.length ? categories : ["Intelligent port services"],
          technologies: technologies.length ? technologies : ["Port infrastructure"],
          keyTechnologies: technologies.length ? technologies : ["Port infrastructure"],
          fundingAmount: null,
          fundingCurrency: "",
          leadInstitutionId: "institution-mpa-singapore",
          leadOrganisation: "Maritime and Port Authority of Singapore",
          partnerOrganisations: [],
          countryCode: "SG",
          country: "Singapore",
          city: "Singapore",
          latitude: 1.2837,
          longitude: 103.8514,
          locationPrecision: "official-country",
          locationConfidence: 88,
          sourceConfidence: 92,
          firstSeenAt: nowIso,
          lastSeenAt: nowIso,
          lastVerifiedAt: nowIso,
          lastUpdatedAt: nowIso,
          plainLanguageSummary: firstSentence(
            text,
            "Official MPA source describing maritime innovation and R&D activity in Singapore."
          ),
          problemAddressed: "",
          proposedSolution: "",
          expectedImpact: "",
          milestones: [
            {
              date: nowIso.slice(0, 10),
              label: "Official MPA page extracted",
              status: "verified",
              sourceIds: [sourceId],
            },
          ],
          researchOutputs: [
            {
              type: "Official project link",
              title,
              date: nowIso.slice(0, 10),
              sourceIds: [sourceId],
            },
          ],
          images: [],
          sourceIds: [sourceId],
          fieldSources: {
            title: [sourceId],
            country: [sourceId],
            city: [sourceId],
            leadOrganisation: [sourceId],
            researchCategories: [sourceId],
            researchOutputs: [sourceId],
          },
          displayReasons: [
            "official_source_confirmation",
            "verified_location",
            "matches_research_category",
            "updated_within_36_months",
            "primary_source_available",
          ],
          extractionMethod: "MPA controlled HTML extractor",
        },
        institution: {
          id: "institution-mpa-singapore",
          rorId: "",
          canonicalName: "Maritime and Port Authority of Singapore",
          aliases: ["MPA Singapore"],
          institutionType: "government",
          countryCode: "SG",
          city: "Singapore",
          latitude: 1.2837,
          longitude: 103.8514,
          website: "https://www.mpa.gov.sg/",
          sourceIds: [sourceId],
        },
        source: {
          id: sourceId,
          publisher: "Maritime and Port Authority of Singapore",
          title,
          url,
          sourceType: "html",
          authorityLevel: "A",
          primaryOrSecondary: "primary",
          publicationDate: "",
          retrievedAt: nowIso,
          contentHash: hashContent(html),
          licence: "Official website; image reuse not assumed",
          extractionMethod: "MPA controlled HTML extractor",
          supportedProjectFields: [
            "title",
            "country",
            "city",
            "leadOrganisation",
            "researchCategories",
            "researchOutputs",
          ],
          reliabilityScore: 92,
        },
        relationship: {
          id: `rel-institution-mpa-singapore-${projectId}`,
          sourceEntityType: "INSTITUTION",
          sourceEntityId: "institution-mpa-singapore",
          targetEntityType: "PROJECT",
          targetEntityId: projectId,
          relationType: "OFFICIAL_ANNOUNCEMENT_MENTION",
          evidenceSourceIds: [sourceId],
          confidence: 92,
          firstObservedAt: nowIso,
          lastVerifiedAt: nowIso,
          explanationData: {
            role: "Official source owner",
            text: "MPA is related because this record was extracted from an official MPA innovation and R&D webpage.",
          },
        },
      });

      console.log(`    ✓ Successfully extracted MPA source`);

      // Delay between requests
      if (url !== MPA_SOURCES[MPA_SOURCES.length - 1]) {
        await delayMs(REQUEST_DELAY_MS);
      }
    } catch (error) {
      console.warn(`    ✗ Failed to fetch MPA source: ${error.message}`);
      errors.push(`${url}: ${error.message}`);
      // Continue with other sources even if one fails
    }
  }

  // Partial failures are tolerated, but if every page failed the source
  // must report a failed run so /sources/status stays honest.
  if (records.length === 0 && errors.length > 0) {
    throw new Error(`All MPA pages failed. ${errors[0]}`);
  }

  return records;
}
