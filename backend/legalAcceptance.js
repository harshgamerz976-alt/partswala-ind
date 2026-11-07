import {
  LEGAL_ACCEPTANCE_REQUIRED,
  LEGAL_POLICY_VERSIONS,
} from "../shared/legalPolicies.js";

export function validateLegalAcceptance(payload) {
  const audience = payload?.audience;
  const required = LEGAL_ACCEPTANCE_REQUIRED[audience];
  if (!required) throw new Error("Choose a valid legal acceptance type.");
  if (!Array.isArray(payload.acceptedPolicies)
    || payload.acceptedPolicies.some((policy) => typeof policy !== "string")
    || required.some((policy) => !payload.acceptedPolicies.includes(policy))) {
    throw new Error("Accept the required policies before continuing.");
  }
  if (typeof payload.marketingConsent !== "boolean") {
    throw new Error("Choose a valid marketing preference.");
  }
  return {
    audience,
    policyVersions: Object.fromEntries(required.map((policy) => [policy, LEGAL_POLICY_VERSIONS[policy]])),
    marketingConsent: payload.marketingConsent,
  };
}

export function registerLegalAcceptanceRoute(app, { authenticatedUser, getDb, now = Date.now }) {
  app.post("/api/legal/acceptance", async (request, response) => {
    const user = await authenticatedUser(request, response);
    if (!user) return;

    let acceptance;
    try {
      acceptance = validateLegalAcceptance(request.body);
    } catch (error) {
      return response.status(400).json({ message: error.message });
    }

    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
      console.error("Legal acceptance timestamp is unavailable.");
      return response.status(503).json({ message: "Your policy acceptance could not be recorded." });
    }

    try {
      await getDb().collection("legalAcceptances").doc().create({
        userId: user.uid,
        ...acceptance,
        acceptedAt: new Date(timestamp).toISOString(),
      });
      return response.status(201).json({
        accepted: true,
        acceptedAt: new Date(timestamp).toISOString(),
        policyVersions: acceptance.policyVersions,
      });
    } catch (error) {
      console.error("Legal acceptance could not be recorded:", error?.code || "firestore_error");
      return response.status(503).json({ message: "Your policy acceptance could not be recorded. Please try again." });
    }
  });
}
