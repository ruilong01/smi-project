import { fetchJson } from "../http.mjs";

export async function enrichInstitutionFromRor(institution) {
  if (!institution.rorId) {
    return institution;
  }

  try {
    const rorId = institution.rorId.split("/").pop();
    const url = `https://api.ror.org/v2/organizations/${rorId}`;
    
    const payload = await fetchJson(url, {
      fetchOptions: {
        email: "research-demo@example.invalid",
        retries: 4,
        timeout: 30000,
        requestDelay: 500,
      },
    });

    const location = payload.locations?.[0];
    const geonames = location?.geonames_details;

    return {
      ...institution,
      rorId: payload.id ?? institution.rorId,
      canonicalName: payload.names?.find((name) => name.types?.includes("ror_display"))?.value ??
        payload.name ??
        institution.canonicalName,
      aliases: payload.names
        ?.filter((name) => name.types?.includes("alias"))
        .map((name) => name.value) ?? institution.aliases,
      institutionType: payload.types?.[0] ?? institution.institutionType,
      city: geonames?.name ?? institution.city,
      countryCode: geonames?.country_code ?? institution.countryCode,
      latitude: geonames?.lat ?? institution.latitude,
      longitude: geonames?.lng ?? institution.longitude,
      website: payload.links?.find((link) => link.type === "website")?.value ?? institution.website,
    };
  } catch (error) {
    console.warn(`Failed to enrich institution from ROR ${institution.rorId}: ${error.message}`);
    return institution; // Return original if enrichment fails
  }
}
