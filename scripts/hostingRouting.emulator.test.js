import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const buildDirectory = process.env.HOSTING_BUILD_DIR;
const hostingUrl = process.env.HOSTING_EMULATOR_URL || "http://127.0.0.1:5000";

function localAssets(indexHtml) {
  const assets = [];
  for (const tag of indexHtml.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attribute = tag[0].match(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/i);
    if (!attribute || !/^\/assets\/.+\.(?:js|css)(?:[?#]|$)/i.test(attribute[2])) continue;
    assets.push(attribute[2]);
  }
  return assets;
}

test("Hosting serves built assets, returns 404 for missing chunks, and preserves SPA documents", async () => {
  assert.ok(buildDirectory, "set HOSTING_BUILD_DIR to the fresh temporary build output");
  const indexHtml = readFileSync(path.join(buildDirectory, "index.html"), "utf8");
  const assetDirectory = path.join(buildDirectory, "assets");
  const [javascriptAsset, cssAsset] = localAssets(indexHtml).reduce((result, asset) => {
    if (asset.endsWith(".js")) result[0] ||= asset;
    if (asset.endsWith(".css")) result[1] ||= asset;
    return result;
  }, []);
  assert.ok(javascriptAsset, "fresh index.html must reference a local JavaScript asset");
  assert.ok(cssAsset, "fresh index.html must reference a local CSS asset");
  const loginChunk = readdirSync(assetDirectory).find((name) => /^Login-.+\.js$/i.test(name));
  assert.ok(loginChunk, "fresh build must contain the lazy Login JavaScript chunk");

  const documentResponse = await fetch(hostingUrl);
  assert.equal(documentResponse.status, 200);
  assert.match(documentResponse.headers.get("content-type") || "", /text\/html/i);
  assert.equal(await documentResponse.text(), indexHtml);

  const apiResponse = await fetch(`${hostingUrl}/api/__hosting_routing_probe__`);
  assert.equal(apiResponse.status, 404, "API paths must not be rewritten to the SPA document");
  assert.notEqual(await apiResponse.text(), indexHtml, "API paths must not receive the SPA document");

  for (const route of [
    "/products",
    "/products/hosting-routing-regression",
    "/product/hosting-routing-regression",
    "/legal/privacy",
    "/profile",
    "/my-enquiries",
    "/cart",
    "/checkout",
    "/login",
    "/forgot-password",
    "/register",
    "/signup",
    "/orders/hosting-routing-regression",
    "/dashboard",
    "/sell",
    "/vendor/login",
    "/vendor/enquiries",
    "/vendor/import",
    "/admin/login",
  ]) {
    const routeResponse = await fetch(`${hostingUrl}${route}`);
    assert.equal(routeResponse.status, 200, `${route} must resolve to the SPA entry point`);
    assert.match(routeResponse.headers.get("content-type") || "", /text\/html/i);
    assert.match(await routeResponse.text(), /<html\b/i);
  }

  for (const [asset, mime] of [
    [javascriptAsset, /(?:java|ecma)script/i],
    [cssAsset, /text\/css/i],
    [`/assets/${loginChunk}`, /(?:java|ecma)script/i],
  ]) {
    const response = await fetch(new URL(asset, hostingUrl));
    assert.equal(response.status, 200, `${asset} must be served from the build`);
    assert.match(response.headers.get("content-type") || "", mime);
  }

  const missingResponse = await fetch(new URL("/assets/__missing-hosting-chunk__.js", hostingUrl));
  assert.equal(missingResponse.status, 404);
  assert.notEqual(await missingResponse.text(), indexHtml, "missing chunks must not receive the SPA document");
});
