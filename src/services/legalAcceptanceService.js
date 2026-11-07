import { BACKEND_API_URL } from "./backendApiUrl";
import {
  LEGAL_ACCEPTANCE_REQUIRED,
  LEGAL_POLICY_VERSIONS,
} from "../../shared/legalPolicies.js";

export async function recordLegalAcceptance(user, audience, marketingConsent, fetchImpl = fetch) {
  if (!user || typeof user.getIdToken !== "function") {
    throw new Error("Sign in is required to record policy acceptance.");
  }
  const acceptedPolicies = LEGAL_ACCEPTANCE_REQUIRED[audience];
  if (!acceptedPolicies || typeof marketingConsent !== "boolean") {
    throw new Error("A valid policy acceptance and marketing preference are required.");
  }
  const token = await user.getIdToken();
  const response = await fetchImpl(`${BACKEND_API_URL}/api/legal/acceptance`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ audience, acceptedPolicies, marketingConsent }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Your policy acceptance could not be recorded.");
  if (result.accepted !== true
    || typeof result.acceptedAt !== "string"
    || !result.policyVersions
    || acceptedPolicies.some((policy) => result.policyVersions[policy] !== LEGAL_POLICY_VERSIONS[policy])) {
    throw new Error("The policy acceptance response was invalid.");
  }
  return result;
}
