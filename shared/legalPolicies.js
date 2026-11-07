export const LEGAL_POLICY_VERSION = "2026-10-31";

export const LEGAL_POLICY_PATHS = Object.freeze({
  privacy: "/legal/privacy",
  terms: "/legal/terms",
  vendorTerms: "/legal/vendor-terms",
  disclaimer: "/legal/disclaimer",
  contact: "/legal/contact",
  cookies: "/legal/cookies",
  enquiries: "/legal/enquiries",
});

export const LEGAL_POLICY_IDS = Object.freeze({
  privacy: "privacy",
  terms: "terms",
  vendorTerms: "vendor-terms",
  disclaimer: "disclaimer",
  contact: "contact-grievance",
  cookies: "cookies",
  enquiries: "enquiries-quotes",
});

export const LEGAL_ACCEPTANCE_REQUIRED = Object.freeze({
  customer: Object.freeze(["privacy", "terms"]),
  vendor: Object.freeze(["privacy", "terms", "vendor-terms"]),
});

export const LEGAL_POLICY_VERSIONS = Object.freeze(
  Object.fromEntries(Object.values(LEGAL_POLICY_IDS).map((id) => [id, LEGAL_POLICY_VERSION])),
);
