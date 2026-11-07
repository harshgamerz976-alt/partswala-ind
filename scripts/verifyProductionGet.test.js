import assert from "node:assert/strict";
import test from "node:test";
import { runProductionGetVerification } from "./verifyProductionGet.js";

const launchTime = "2026-11-07T18:30:00.000Z";
const productId = "never-print-this-product-id";
const jsPath = "/assets/index-abcdefgh1234.js";
const cssPath = "/assets/index-abcdefgh1234.css";
const html = `<html><head><link rel="stylesheet" href="${cssPath}"></head><body><script type="module" src="${jsPath}"></script></body></html>`;
const apiSecurityHeaders = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const hostingSecurityHeaders = {
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "content-security-policy-report-only": "default-src 'self'; object-src 'none'",
};

function response(status, body = "", headers = {}) {
  return new Response(body, { status, headers });
}

function createFetch({ leaked = false, redirectLoop = false, omitApiSecurityHeader = false, omitHostingSecurityHeader = false } = {}) {
  const requests = [];
  const apiHeaders = { ...apiSecurityHeaders };
  const webHeaders = { ...hostingSecurityHeaders };
  if (omitApiSecurityHeader) delete apiHeaders["x-frame-options"];
  if (omitHostingSecurityHeader) delete webHeaders["x-frame-options"];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    requests.push({ url, options });
    assert.equal(options.method, "GET");

    if (url.hostname === "api.example.test") {
      if (url.pathname === "/health") return response(200, '{"ok":true}', { ...apiHeaders, "content-type": "application/json" });
      if (url.pathname === "/api/settings/public") {
        return response(200, JSON.stringify({
          preLaunchEnabled: true,
          launchTime,
          serverTimeUtc: "2026-11-06T00:00:00.000Z",
          millisecondsUntilLaunch: Date.parse(launchTime) - Date.parse("2026-11-06T00:00:00.000Z"),
        }), { ...apiHeaders, "content-type": "application/json", "cache-control": "no-store" });
      }
      if (leaked && url.pathname === "/api/public-products") {
        return response(200, '{"products":[{"id":"private"}]}', { ...apiHeaders, "content-type": "application/json" });
      }
      if (["/api/vendor/access", "/api/enquiries", "/api/vendor/enquiries", "/api/vendor/dashboard"].includes(url.pathname)) {
        return response(401, '{"message":"Authentication is required."}', {
          ...apiHeaders,
          "content-type": "application/json",
          "cache-control": "no-store",
        });
      }
      return response(403, '{"message":"The marketplace is not open yet."}', {
        ...apiHeaders,
        "content-type": "application/json",
        "cache-control": "no-store",
      });
    }

    if (redirectLoop && url.hostname === "partswalaind.com" && url.pathname === "/") {
      return response(301, "", { location: url.href });
    }
    if (url.pathname === "/") {
      return response(200, html, {
        ...webHeaders,
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-cache, max-age=0, must-revalidate",
      });
    }
    if (url.pathname === jsPath) {
      return response(200, "export {};", {
        ...webHeaders,
        "content-type": "text/javascript",
        "cache-control": "public, max-age=31536000, immutable",
      });
    }
    if (url.pathname === cssPath) {
      return response(200, "body{}", {
        ...webHeaders,
        "content-type": "text/css",
        "cache-control": "public, max-age=31536000, immutable",
      });
    }
    if (url.pathname.startsWith("/assets/__partswala_missing_")) {
      return response(404, "Not Found", { ...webHeaders, "content-type": "text/plain" });
    }
    return response(200, html, {
      ...webHeaders,
      "content-type": "text/html",
      "cache-control": "no-cache, max-age=0, must-revalidate",
    });
  };
  return { fetchImpl, requests };
}

test("production verifier checks pre-launch GET gates and both Hosting sites without printing bodies or IDs", async () => {
  const { fetchImpl, requests } = createFetch();
  const lines = [];
  const result = await runProductionGetVerification({
    apiOrigin: "https://api.example.test",
    frontendOrigins: ["https://partswalaind.web.app", "https://partswalaind.com"],
    productId,
    fetchImpl,
    output: (line) => lines.push(line),
  });

  assert.equal(result.passed, true);
  assert.ok(requests.length > 20);
  assert.ok(requests.every(({ options }) => options.method === "GET"));
  assert.equal(requests.some(({ url }) =>
    url.pathname.endsWith("/api/public-products/by-ids")
      || url.pathname.endsWith("/api/products/vendor-names"),
  ), false);
  assert.ok(lines.some((line) => line.startsWith("SKIP POST-only catalogue by-ids and vendor-names routes")));
  assert.ok(lines.every((line) => !line.includes(productId)));
  assert.ok(lines.every((line) => !line.includes('"products"')));
});

test("production verifier fails closed on a catalogue leak and never logs the response body", async () => {
  const { fetchImpl } = createFetch({ leaked: true });
  const lines = [];
  const result = await runProductionGetVerification({
    apiOrigin: "https://api.example.test",
    frontendOrigins: [],
    productId,
    fetchImpl,
    output: (line) => lines.push(line),
  });

  test("production verifier detects missing API and Hosting security headers", async () => {
    const { fetchImpl: apiFetch } = createFetch({ omitApiSecurityHeader: true });
    const apiLines = [];
    const apiResult = await runProductionGetVerification({
      apiOrigin: "https://api.example.test",
      frontendOrigins: [],
      productId,
      fetchImpl: apiFetch,
      output: (line) => apiLines.push(line),
    });
    assert.equal(apiResult.passed, false);
    assert.ok(apiLines.some((line) => line.startsWith("FAIL API health") && line.includes("security headers")));

    const { fetchImpl: hostingFetch } = createFetch({ omitHostingSecurityHeader: true });
    const hostingLines = [];
    const hostingResult = await runProductionGetVerification({
      apiOrigin: "https://api.example.test",
      frontendOrigins: ["https://partswalaind.web.app"],
      productId,
      fetchImpl: hostingFetch,
      output: (line) => hostingLines.push(line),
    });
    assert.equal(hostingResult.passed, false);
    assert.ok(hostingLines.some((line) => line.startsWith("FAIL partswalaind.web.app HTML root/cache") && line.includes("security headers")));
  });

  assert.equal(result.passed, false);
  assert.ok(result.results.some(({ label, passed }) => label === "catalogue list" && !passed));
  assert.ok(lines.some((line) => line.startsWith("FAIL catalogue list")));
  assert.ok(lines.every((line) => !line.includes(productId)));
  assert.ok(lines.every((line) => !line.includes('"products"')));
});

test("production verifier rejects non-HTTPS production origins before making requests", async () => {
  let requested = false;
  const lines = [];
  const result = await runProductionGetVerification({
    apiOrigin: "http://api.example.test",
    fetchImpl: async () => { requested = true; },
    output: (line) => lines.push(line),
  });

  assert.equal(result.passed, false);
  assert.equal(requested, false);
  assert.ok(lines[0].includes("must be an HTTPS origin"));
});

test("production verifier detects a custom-domain redirect loop without printing redirect targets", async () => {
  const { fetchImpl } = createFetch({ redirectLoop: true });
  const lines = [];
  const result = await runProductionGetVerification({
    apiOrigin: "https://api.example.test",
    frontendOrigins: ["https://partswalaind.com"],
    productId,
    fetchImpl,
    output: (line) => lines.push(line),
  });

  assert.equal(result.passed, false);
  assert.ok(result.results.some(({ label, passed }) => label === "partswalaind.com HTML root/cache" && !passed));
  assert.ok(lines.every((line) => !line.includes("https://")));
  assert.ok(lines.every((line) => !line.includes(productId)));
});
