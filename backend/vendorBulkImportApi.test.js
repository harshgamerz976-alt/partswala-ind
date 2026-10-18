import test from "node:test";
import assert from "node:assert/strict";
import { requestVendorBulkImport } from "../shared/vendorBulkImportApi.js";

const user = { getIdToken: async () => "vendor-id-token" };

test("bulk-import preview sends the authenticated user's file without client vendor identity", async () => {
  const file = new Blob(["workbook"], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const calls = [];
  const result = await requestVendorBulkImport({
    user,
    baseUrl: "http://localhost:8787/",
    path: "/api/vendor/import-products",
    file,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, json: async () => ({ importMode: "preview", validRows: 1 }) };
    },
  });

  assert.equal(calls[0].url, "http://localhost:8787/api/vendor/import-products");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer vendor-id-token");
  assert.equal(calls[0].options.body.get("file").size, file.size);
  assert.equal(calls[0].options.body.has("confirm"), false);
  assert.equal(calls[0].options.body.has("vendorId"), false);
  assert.deepEqual(result, { importMode: "preview", validRows: 1 });
});

test("bulk-import confirmation posts the confirm flag through the same route", async () => {
  let submitted;
  await requestVendorBulkImport({
    user,
    baseUrl: "http://localhost:8787",
    path: "/api/vendor/import-products",
    file: new Blob(["workbook"]),
    confirm: true,
    fetchImpl: async (_url, options) => {
      submitted = options;
      return { ok: true, json: async () => ({ importMode: "confirmed" }) };
    },
  });

  assert.equal(submitted.body.get("confirm"), "true");
  assert.equal(submitted.headers.Authorization, "Bearer vendor-id-token");
});

test("bulk-import client requires a signed-in user and surfaces API errors", async () => {
  await assert.rejects(
    requestVendorBulkImport({ user: null, baseUrl: "http://localhost:8787", path: "/api/vendor/import-products" }),
    /Sign in is required/,
  );
  await assert.rejects(
    requestVendorBulkImport({
      user,
      baseUrl: "http://localhost:8787",
      path: "/api/vendor/import-products",
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ message: "Approved vendor access is required." }),
      }),
    }),
    /HTTP 403 Forbidden for \/api\/vendor\/import-products\. Approved vendor access is required/,
  );
});

test("template request uses the registered API path and accepts only an Excel response", async () => {
  const responseBlob = new Blob(["PK"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  let requestedUrl;
  const result = await requestVendorBulkImport({
    user,
    baseUrl: "https://partswala-ind.onrender.com/",
    path: "/api/vendor/import-template",
    responseType: "blob",
    expectedContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fetchImpl: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        headers: new Headers({ "content-type": responseBlob.type }),
        blob: async () => responseBlob,
      };
    },
  });
  assert.equal(requestedUrl, "https://partswala-ind.onrender.com/api/vendor/import-template");
  assert.equal(result.type, responseBlob.type);
  assert.equal(await result.text(), "PK");
});

test("template 404 reports status and route instead of a generic failure", async () => {
  await assert.rejects(
    requestVendorBulkImport({
      user,
      baseUrl: "https://partswala-ind.onrender.com",
      path: "/api/vendor/import-template",
      responseType: "blob",
      expectedContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => "<html>not found</html>",
      }),
    }),
    /HTTP 404 Not Found for \/api\/vendor\/import-template/,
  );
});

test("network failures identify the requested route without including credentials", async () => {
  await assert.rejects(
    requestVendorBulkImport({
      user,
      baseUrl: "https://partswala-ind.onrender.com",
      path: "/api/vendor/import-products",
      fetchImpl: async (_url, options) => {
        assert.equal(options.headers.Authorization, "Bearer vendor-id-token");
        throw new TypeError("Failed to fetch");
      },
    }),
    (error) => {
      assert.match(error.message, /Network request failed for \/api\/vendor\/import-products: Failed to fetch/);
      assert.equal(error.message.includes("vendor-id-token"), false);
      return true;
    },
  );
});
