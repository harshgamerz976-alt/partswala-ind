import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

test("legal acceptance service sends required policy IDs and independent marketing choice", async (t) => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  const { recordLegalAcceptance } = await vite.ssrLoadModule("/src/services/legalAcceptanceService.js");
  let request;
  const result = await recordLegalAcceptance({
    async getIdToken() { return "test-token"; },
  }, "vendor", false, async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      async json() {
        return {
          accepted: true,
          acceptedAt: "2026-10-31T12:00:00.000Z",
          policyVersions: {
            privacy: "2026-10-31",
            terms: "2026-10-31",
            "vendor-terms": "2026-10-31",
          },
        };
      },
    };
  });
  assert.equal(request.url.endsWith("/api/legal/acceptance"), true);
  assert.equal(request.options.cache, "no-store");
  assert.equal(request.options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(request.options.body), {
    audience: "vendor",
    acceptedPolicies: ["privacy", "terms", "vendor-terms"],
    marketingConsent: false,
  });
  assert.equal(result.accepted, true);
});

test("legal acceptance service requires authentication, propagates API errors, and rejects malformed success", async (t) => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  const { recordLegalAcceptance } = await vite.ssrLoadModule("/src/services/legalAcceptanceService.js");
  await assert.rejects(recordLegalAcceptance(null, "customer", false), /sign in/i);
  await assert.rejects(recordLegalAcceptance({ getIdToken: async () => "token" }, "customer", false, async () => ({
    ok: false,
    json: async () => ({ message: "Acceptance could not be saved." }),
  })), /could not be saved/i);
  await assert.rejects(recordLegalAcceptance({ getIdToken: async () => "token" }, "customer", false, async () => ({
    ok: true,
    json: async () => ({ accepted: true, acceptedAt: "now", policyVersions: { privacy: "old", terms: "2026-10-31" } }),
  })), /response was invalid/i);
});
