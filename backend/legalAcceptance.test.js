import assert from "node:assert/strict";
import test from "node:test";
import { registerLegalAcceptanceRoute, validateLegalAcceptance } from "./legalAcceptance.js";

const customerAcceptance = {
  audience: "customer",
  acceptedPolicies: ["privacy", "terms"],
  marketingConsent: false,
};

test("legal acceptance requires applicable policies and a separate explicit marketing choice", () => {
  assert.deepEqual(validateLegalAcceptance(customerAcceptance), {
    audience: "customer",
    policyVersions: { privacy: "2026-10-31", terms: "2026-10-31" },
    marketingConsent: false,
  });
  assert.throws(() => validateLegalAcceptance({ ...customerAcceptance, acceptedPolicies: ["privacy"] }), /required policies/i);
  assert.throws(() => validateLegalAcceptance({ ...customerAcceptance, marketingConsent: undefined }), /marketing preference/i);
  assert.throws(() => validateLegalAcceptance({ ...customerAcceptance, audience: "vendor" }), /required policies/i);
  assert.throws(() => validateLegalAcceptance({ ...customerAcceptance, audience: "admin" }), /acceptance type/i);
});

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(statusCode) { this.statusCode = statusCode; return this; },
    json(body) { this.body = body; return this; },
  };
}

test("legal acceptance route records server timestamp and versions for authenticated user only", async () => {
  let handler;
  let stored;
  const app = { post(path, callback) { assert.equal(path, "/api/legal/acceptance"); handler = callback; } };
  registerLegalAcceptanceRoute(app, {
    authenticatedUser: async () => ({ uid: "user-1" }),
    getDb: () => ({
      collection(name) {
        assert.equal(name, "legalAcceptances");
        return { doc: () => ({ create: async (record) => { stored = record; } }) };
      },
    }),
    now: () => Date.parse("2026-10-31T12:00:00.000Z"),
  });
  const response = responseRecorder();
  await handler({ body: customerAcceptance }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(stored.userId, "user-1");
  assert.equal(stored.acceptedAt, "2026-10-31T12:00:00.000Z");
  assert.deepEqual(stored.policyVersions, { privacy: "2026-10-31", terms: "2026-10-31" });
  assert.equal(stored.marketingConsent, false);
});

test("legal acceptance route does not write when authentication or payload validation fails", async () => {
  let handler;
  let writes = 0;
  const app = { post(_path, callback) { handler = callback; } };
  registerLegalAcceptanceRoute(app, {
    authenticatedUser: async (_request, response) => {
      response.status(401).json({ message: "Authentication required." });
      return null;
    },
    getDb: () => ({ collection: () => ({ doc: () => ({ create: async () => { writes += 1; } }) }) }),
  });
  const unauthenticatedResponse = responseRecorder();
  await handler({ body: customerAcceptance }, unauthenticatedResponse);
  assert.equal(unauthenticatedResponse.statusCode, 401);

  registerLegalAcceptanceRoute(app, {
    authenticatedUser: async () => ({ uid: "user-1" }),
    getDb: () => ({ collection: () => ({ doc: () => ({ create: async () => { writes += 1; } }) }) }),
  });
  const invalidResponse = responseRecorder();
  await handler({ body: { ...customerAcceptance, acceptedPolicies: [] } }, invalidResponse);
  assert.equal(invalidResponse.statusCode, 400);
  assert.equal(writes, 0);
});
