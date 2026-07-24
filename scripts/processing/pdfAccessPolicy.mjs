// Centralized PDF access/licence policy for the in-app PDF reader (see
// docs/IN_APP_PDF_READER.md). Given the same real OA evidence the
// discover:oa-pdfs pipeline already gathered (license text, isOpenAccess,
// oaEvidence), decides two independent things:
//   - serveInApp:        safe to render inline in the app's own viewer?
//   - allowUserDownload: safe to also offer an explicit "Download" link?
// Bump PDF_ACCESS_POLICY_VERSION whenever the rules below change, so any
// stored/derived decision can be told apart from one made under an older
// ruleset (same convention as imageSourceClassifier.mjs's CLASSIFIER_VERSION).
//
// Important limitation (documented, not hidden): this is an application-
// level policy, not a technical access-control guarantee. A PDF rendered
// inline via a browser's native viewer can still be saved by the user
// through that viewer's own UI - `allowUserDownload: false` only means
// this app itself won't provide an explicit download affordance, not that
// saving is technically prevented.

export const PDF_ACCESS_POLICY_VERSION = 1;

// Known permissive open licenses/terms - safe to view AND to offer a
// download link for.
const PERMISSIVE_LICENSE_PATTERN =
  /^cc-?by(-sa|-nd)?$|^cc0$|public[\s-]?domain|arxiv\.org perpetual|perpetual.*non-exclusive/i;

// Non-commercial variants: still a real open license, but "non-commercial"
// carries enough ambiguity for an internal-but-cross-institution tool that
// this app stays conservative and withholds the explicit download link.
const NONCOMMERCIAL_LICENSE_PATTERN = /-nc(-nd|-sa)?$|non[\s-]?commercial/i;

// Explicit red flags - never serve, regardless of any OA claim elsewhere.
const RESTRICTIVE_LICENSE_PATTERN = /all rights reserved|proprietary|confidential|restricted use/i;

/**
 * @param {object} input
 * @param {string} [input.license] - raw license string recorded by discoverOpenAccessPdfs.mjs
 * @param {boolean} input.isOpenAccess
 * @param {string} [input.oaEvidence]
 * @returns {{ serveInApp: boolean, allowUserDownload: boolean, policyReason: string, policyVersion: number }}
 */
export function evaluatePdfAccessPolicy({ license, isOpenAccess, oaEvidence } = {}) {
  if (!isOpenAccess || !oaEvidence) {
    return {
      serveInApp: false,
      allowUserDownload: false,
      policyReason: "No confirmed open-access evidence - never served in-app.",
      policyVersion: PDF_ACCESS_POLICY_VERSION,
    };
  }

  const licenseText = (license || "").trim().toLowerCase();

  if (licenseText && RESTRICTIVE_LICENSE_PATTERN.test(licenseText)) {
    return {
      serveInApp: false,
      allowUserDownload: false,
      policyReason: `License text ("${license}") matches a restrictive/proprietary pattern.`,
      policyVersion: PDF_ACCESS_POLICY_VERSION,
    };
  }

  if (licenseText && PERMISSIVE_LICENSE_PATTERN.test(licenseText)) {
    return {
      serveInApp: true,
      allowUserDownload: true,
      policyReason: `License ("${license}") is a known permissive open license.`,
      policyVersion: PDF_ACCESS_POLICY_VERSION,
    };
  }

  if (licenseText && NONCOMMERCIAL_LICENSE_PATTERN.test(licenseText)) {
    return {
      serveInApp: true,
      allowUserDownload: false,
      policyReason: `License ("${license}") is non-commercial - viewable in-app, download link withheld out of caution.`,
      policyVersion: PDF_ACCESS_POLICY_VERSION,
    };
  }

  // Confirmed OA evidence exists, but the license text is missing or not
  // one of the recognized patterns above - safe to view (the source itself
  // already asserts open access), conservative on offering a download link
  // until a human reviews the exact terms.
  return {
    serveInApp: true,
    allowUserDownload: false,
    policyReason: license
      ? `License text ("${license}") not recognized - viewable on OA evidence, download withheld pending review.`
      : "No license text recorded - viewable on OA evidence, download withheld pending review.",
    policyVersion: PDF_ACCESS_POLICY_VERSION,
  };
}

/**
 * Manifest entries written before this policy existed have no
 * serveInApp/allowUserDownload/isOpenAccess/license fields at all (not
 * `false` - genuinely absent, a different schema generation). Rather than
 * silently 404-ing every PDF downloaded before this feature landed, derive
 * a conservative policy for them: a manifest entry only exists because
 * discoverOpenAccessPdfs.mjs's own legality gate already required
 * confirmed OA evidence before writing it, so `isOpenAccess: true` is a
 * safe inference (a structural invariant of that pipeline, not a guess) -
 * paired with no known license, evaluatePdfAccessPolicy already produces
 * "viewable, download withheld pending review".
 * @param {object} entry - a data/server/runtime/pdf-download-manifest.json download entry
 */
export function resolveOrDerivePolicy(entry) {
  if (typeof entry?.serveInApp === "boolean" && typeof entry?.allowUserDownload === "boolean") {
    return {
      serveInApp: entry.serveInApp,
      allowUserDownload: entry.allowUserDownload,
      policyReason: entry.policyReason || "(preserved from manifest)",
      policyVersion: entry.policyVersion ?? PDF_ACCESS_POLICY_VERSION,
    };
  }
  const isOpenAccess = typeof entry?.isOpenAccess === "boolean" ? entry.isOpenAccess : true;
  const oaEvidence =
    entry?.oaEvidence ||
    "inferred: entry predates policy metadata; discoverOpenAccessPdfs.mjs requires confirmed OA evidence before a PDF is ever downloaded.";
  return evaluatePdfAccessPolicy({ license: entry?.license ?? null, isOpenAccess, oaEvidence });
}
