import assert from "node:assert/strict";
import test from "node:test";
import { resolveBackendApiUrl } from "./backendApiUrl.js";

test("backend URL uses configured value or environment-specific safe defaults", () => {
  assert.equal(resolveBackendApiUrl({ configuredUrl: "https://api.example.test/" }), "https://api.example.test");
  assert.equal(resolveBackendApiUrl({ isProduction: true }), "https://partswala-ind.onrender.com");
  assert.equal(resolveBackendApiUrl({ configuredUrl: "http://localhost:8787", isProduction: true }), "https://partswala-ind.onrender.com");
  assert.equal(resolveBackendApiUrl(), "http://localhost:8787");
});
