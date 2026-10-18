import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchPublicSiteSettings,
  SETTINGS_REQUEST_TIMEOUT_MS,
} from "../shared/publicSiteSettings.js";

test("public settings requests use the expected backend URL and cold-start timeout", async () => {
  let requestedUrl;
  let requestOptions;
  const settings = await fetchPublicSiteSettings("https://partswala-ind.onrender.com/", {
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestOptions = options;
      return {
        ok: true,
        json: async () => ({ preLaunchEnabled: false, comingSoonVideoUrl: "" }),
      };
    },
  });

  assert.equal(requestedUrl, "https://partswala-ind.onrender.com/api/settings/public");
  assert.equal(requestOptions.cache, "no-store");
  assert.equal(requestOptions.signal.aborted, false);
  assert.equal(SETTINGS_REQUEST_TIMEOUT_MS, 60000);
  assert.deepEqual(settings, { preLaunchEnabled: false, comingSoonVideoUrl: "" });
});

test("settings timeouts report a safe specific failure", async () => {
  await assert.rejects(
    fetchPublicSiteSettings("https://partswala-ind.onrender.com", {
      timeoutMs: 500,
      fetchImpl: async () => {
        const error = new Error("signal timed out");
        error.name = "TimeoutError";
        throw error;
      },
    }),
    /timed out after 0\.5 seconds/,
  );
});

test("settings HTTP failures preserve status and do not fall back to launch-open", async () => {
  await assert.rejects(
    fetchPublicSiteSettings("https://partswala-ind.onrender.com", {
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ message: "Public site settings could not be loaded." }),
      }),
    }),
    /HTTP 500 Internal Server Error for \/api\/settings\/public/,
  );
});

test("malformed settings are rejected rather than defaulting the launch gate open", async () => {
  await assert.rejects(
    fetchPublicSiteSettings("https://partswala-ind.onrender.com", {
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    }),
    /invalid pre-launch value/,
  );
});
