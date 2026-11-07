import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import app, { setApiNoStore } from "./server.js";

test("CORS rejects an unapproved origin explicitly without granting browser access", async () => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/public-products`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://unapproved-origin.example",
        "Access-Control-Request-Method": "GET",
      },
    });

    test("API responses remain no-store when Express accepts differently cased paths", () => {
      for (const requestPath of ["/api/reviews", "/API/reviews", "/Api/public-products/part-1"]) {
        let cacheControl;
        setApiNoStore(
          { path: requestPath },
          { set: (name, value) => { if (name === "Cache-Control") cacheControl = value; } },
          () => {},
        );
        assert.equal(cacheControl, "no-store", `${requestPath} must not be cached`);
      }
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await response.json(), { message: "Origin is not allowed." });

    for (const origin of [
      "https://partswalaflutter.web.app",
      "https://partswalaind.web.app",
      "https://partswalaind.com",
    ]) {
      const allowedResponse = await fetch(`http://127.0.0.1:${address.port}/api/public-products`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "GET",
        },
      });
      assert.equal(allowedResponse.status, 204);
      assert.equal(allowedResponse.headers.get("access-control-allow-origin"), origin);
    }
  } finally {
    server.close();
  }
});
