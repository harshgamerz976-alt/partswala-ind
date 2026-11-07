import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchPublicAssistantSettings,
  fetchPublicSiteSettings,
  SETTINGS_REQUEST_TIMEOUT_MS,
} from "../shared/publicSiteSettings.js";
import { getLaunchTargetMs, PARTSWALA_LAUNCH_UTC } from "../shared/preLaunch.js";

const launchTimeMs = getLaunchTargetMs();
const launchTimeIso = new Date(launchTimeMs).toISOString();

test("public settings requests use the expected backend URL and cold-start timeout", async () => {
  let requestedUrl;
  let requestOptions;
  const settings = await fetchPublicSiteSettings("https://partswala-ind.onrender.com/", {
    fetchImpl: async (url, options) => {
      requestedUrl = url;
      requestOptions = options;
      return {
        ok: true,
        json: async () => ({
          preLaunchEnabled: false,
          launchTime: PARTSWALA_LAUNCH_UTC,
          serverTimeUtc: launchTimeIso,
          millisecondsUntilLaunch: 0,
        }),
      };
    },
  });

  assert.equal(requestedUrl, "https://partswala-ind.onrender.com/api/settings/public");
  assert.equal(requestOptions.cache, "no-store");
  assert.equal(requestOptions.signal.aborted, false);
  assert.equal(SETTINGS_REQUEST_TIMEOUT_MS, 60000);
  assert.deepEqual(settings, {
    preLaunchEnabled: false,
    launchTime: PARTSWALA_LAUNCH_UTC,
    serverTimeUtc: launchTimeIso,
    millisecondsUntilLaunch: 0,
  });
});

test("public assistant settings use a no-store request and expose only enabled", async () => {
  let endpoint;
  let options;
  const result = await fetchPublicAssistantSettings("https://partswala-ind.onrender.com/", {
    fetchImpl: async (url, requestOptions) => {
      endpoint = url;
      options = requestOptions;
      return { ok: true, json: async () => ({ enabled: false, supportPhone: "not-forwarded" }) };
    },
  });
  assert.equal(endpoint, "https://partswala-ind.onrender.com/api/settings/assistant/public");
  assert.equal(options.cache, "no-store");
  assert.deepEqual(result, { enabled: false });
});

test("public assistant settings reject HTTP errors and malformed data", async () => {
  await assert.rejects(fetchPublicAssistantSettings("https://partswala-ind.onrender.com", {
    fetchImpl: async () => ({ ok: false, status: 403, statusText: "Forbidden", json: async () => ({ message: "Not launched." }) }),
  }), /HTTP 403 Forbidden/);
  await assert.rejects(fetchPublicAssistantSettings("https://partswala-ind.onrender.com", {
    fetchImpl: async () => ({ ok: true, json: async () => ({ enabled: "false" }) }),
  }), /invalid enabled value/);
});

test("authoritative launch status is validated one millisecond before, exactly at, and after launch", async () => {
  for (const [serverTimeMs, expectedOpen, expectedRemaining] of [
    [launchTimeMs - 1, true, 1],
    [launchTimeMs, false, 0],
    [launchTimeMs + 1, false, 0],
  ]) {
    const settings = await fetchPublicSiteSettings("https://partswala-ind.onrender.com", {
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          preLaunchEnabled: expectedOpen,
          launchTime: PARTSWALA_LAUNCH_UTC,
          serverTimeUtc: new Date(serverTimeMs).toISOString(),
          millisecondsUntilLaunch: expectedRemaining,
        }),
      }),
    });
    assert.equal(settings.preLaunchEnabled, expectedOpen);
    assert.equal(settings.serverTimeUtc, new Date(serverTimeMs).toISOString());
    assert.equal(settings.millisecondsUntilLaunch, expectedRemaining);
  }
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

test("launch status with invalid or inconsistent server timing is rejected closed", async () => {
  for (const status of [
    { preLaunchEnabled: false, launchTime: PARTSWALA_LAUNCH_UTC, millisecondsUntilLaunch: 1, serverTimeUtc: launchTimeIso },
    { preLaunchEnabled: true, launchTime: PARTSWALA_LAUNCH_UTC, millisecondsUntilLaunch: Number.NaN, serverTimeUtc: launchTimeIso },
    { preLaunchEnabled: false, launchTime: "2026-11-08T00:00:00+05:30", millisecondsUntilLaunch: 0, serverTimeUtc: launchTimeIso },
    { preLaunchEnabled: true, launchTime: PARTSWALA_LAUNCH_UTC, millisecondsUntilLaunch: 1 },
    { preLaunchEnabled: true, launchTime: PARTSWALA_LAUNCH_UTC, millisecondsUntilLaunch: 2, serverTimeUtc: new Date(launchTimeMs - 1).toISOString() },
    { preLaunchEnabled: false, launchTime: PARTSWALA_LAUNCH_UTC, millisecondsUntilLaunch: 0, serverTimeUtc: "not-a-time" },
    { preLaunchEnabled: false, launchTime: PARTSWALA_LAUNCH_UTC, millisecondsUntilLaunch: 0, serverTimeUtc: "2026-11-07T18:30:00Z" },
  ]) {
    await assert.rejects(
      fetchPublicSiteSettings("https://partswala-ind.onrender.com", {
        fetchImpl: async () => ({ ok: true, json: async () => status }),
      }),
      /invalid authoritative launch status/,
    );
  }
});
