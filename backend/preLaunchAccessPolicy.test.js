import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { getLaunchTargetMs } from "../shared/preLaunch.js";
import { createPreLaunchAccessPolicy } from "./preLaunchAccessPolicy.js";

async function startPolicyApi(now) {
  const app = express();
  app.use(createPreLaunchAccessPolicy({ now }));
  app.use((_request, response) => response.status(200).json({ reachedRoute: true }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test("central pre-launch policy blocks all public catalogue and related data routes before handlers", async (t) => {
  const api = await startPolicyApi(() => getLaunchTargetMs() - 1);
  t.after(api.close);

  const paths = [
    "/api/public-products?limit=1",
    "/api/public-products/product-1?expand=details",
    "/api/public-products/product-1/",
    "/api/public-products/by-ids?productIds=product-1",
    "/API/PUBLIC-PRODUCTS?limit=1",
    "/api/products/vendor-names?productIds=product-1",
    "/api/products/vendor-names/",
    "/api/products/product-1/vendor-contact?source=card",
    "/api/products/product-1/vendor-contact/",
    "/api/reviews?productId=product-1",
    "/api/reviews/",
    "/api/settings/assistant/public?include=enabled",
  ];

  for (const path of paths) {
    const response = await fetch(`${api.baseUrl}${path}`);
    assert.equal(response.status, 403, `${path} must be blocked before launch`);
    assert.equal(response.headers.get("cache-control"), "no-store", `${path} must not be cached`);
    assert.deepEqual(await response.json(), { message: "The PartsWalaIND marketplace is not open yet." });
  }
});

test("central pre-launch policy denies POST access without requiring authentication or parsing a body", async (t) => {
  const api = await startPolicyApi(() => getLaunchTargetMs() - 1);
  t.after(api.close);

  for (const [path, body] of [
    ["/api/public-products/by-ids?requested=1", "{invalid-json"],
    ["/api/products/vendor-names?productIds=product-1", "{invalid-json"],
    ["/api/reviews?productId=product-1", "{invalid-json"],
  ]) {
    const response = await fetch(`${api.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("central pre-launch policy preserves health and safe public launch settings", async (t) => {
  const api = await startPolicyApi(() => getLaunchTargetMs() - 1);
  t.after(api.close);

  for (const path of ["/health", "/api/settings/public"]) {
    const response = await fetch(`${api.baseUrl}${path}`);
    assert.equal(response.status, 200);
  }

  const preflight = await fetch(`${api.baseUrl}/api/public-products`, { method: "OPTIONS" });
  assert.equal(preflight.status, 200);
});

test("central pre-launch policy fails closed for invalid server time and opens exactly at launch", async () => {
  for (const [now, expectedStatus] of [
    [() => Number.NaN, 403],
    [() => undefined, 403],
    [() => null, 403],
    [() => Number.POSITIVE_INFINITY, 403],
    [() => Number.NEGATIVE_INFINITY, 403],
    [() => Number.MAX_SAFE_INTEGER, 403],
    [() => Number.MIN_SAFE_INTEGER, 403],
    [() => 8_640_000_000_000_001, 403],
    [() => -8_640_000_000_000_001, 403],
    [() => new Date("invalid").getTime(), 403],
    [() => getLaunchTargetMs() - 0.5, 403],
    [() => getLaunchTargetMs(), 200],
    [() => getLaunchTargetMs() + 1, 200],
  ]) {
    const api = await startPolicyApi(now);
    try {
      const response = await fetch(`${api.baseUrl}/api/public-products?limit=1`);
      assert.equal(response.status, expectedStatus);
      if (expectedStatus === 403) assert.equal(response.headers.get("cache-control"), "no-store");
    } finally {
      await api.close();
    }
  }
});
