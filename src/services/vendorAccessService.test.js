import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("vendor access is verified with a no-store authenticated backend request", async () => {
  const vite = await createServer({
    appType: "custom",
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true },
  });

  try {
    const { getVerifiedVendorAccess } = await vite.ssrLoadModule("/src/services/vendorAccessService.js");
    const requests = [];
    const user = { getIdToken: async () => "firebase-test-token" };
    const approved = await getVerifiedVendorAccess(user, async (url, options) => {
      requests.push({ url, options });
      return response(200, { approvedVendor: true });
    });

    assert.equal(approved, true);
    assert.equal(requests[0].url.endsWith("/api/vendor/access"), true);
    assert.equal(requests[0].options.cache, "no-store");
    assert.equal(requests[0].options.headers.Authorization, "Bearer firebase-test-token");
    assert.equal(await getVerifiedVendorAccess(user, async () => response(403, { approvedVendor: false })), false);
    await assert.rejects(
      getVerifiedVendorAccess(user, async () => response(503, { message: "Approval service unavailable." })),
      /Approval service unavailable/,
    );
    await assert.rejects(getVerifiedVendorAccess(null), /signed-in account is required/);
  } finally {
    await vite.close();
  }
});
