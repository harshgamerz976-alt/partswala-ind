import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import app from "./server.js";
import { getLaunchTargetMs } from "../shared/preLaunch.js";

test("the mounted backend blocks every public product and review route before launch", async (t) => {
  const previousClock = app.locals.launchClock;
  app.locals.launchClock = () => getLaunchTargetMs() - 1;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    app.locals.launchClock = previousClock;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  for (const [method, path, body] of [
    ["GET", "/api/public-products?limit=1"],
    ["GET", "/api/public-products/product-1/"],
    ["GET", "/api/Public-products?limit=1"],
    ["POST", "/api/public-products/by-ids?source=compare", "{invalid-json"],
    ["GET", "/api/products/product-1/vendor-contact?source=card"],
    ["GET", "/api/products/product-1/vendor-contact/"],
    ["POST", "/api/products/vendor-names?source=listing", "{invalid-json"],
    ["GET", "/api/reviews?productId=product-1"],
    ["POST", "/api/reviews?source=detail", "{invalid-json"],
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      ...(body === undefined ? {} : {
        headers: { "Content-Type": "application/json" },
        body,
      }),
    });
    assert.equal(response.status, 403, `${method} ${path} must be blocked before launch`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { message: "The PartsWalaIND marketplace is not open yet." });
  }

  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  const settings = await fetch(`${baseUrl}/api/settings/public`);
  assert.equal(settings.status, 200);
  assert.deepEqual(Object.keys(await settings.json()).sort(), [
    "launchTime",
    "millisecondsUntilLaunch",
    "preLaunchEnabled",
    "serverTimeUtc",
  ]);
});
