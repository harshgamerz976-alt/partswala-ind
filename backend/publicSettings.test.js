import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { getLaunchTargetMs, PARTSWALA_LAUNCH_UTC } from "../shared/preLaunch.js";
import { registerPublicSettingsRoute } from "./publicSettings.js";

async function withPublicSettingsEndpoint(
  readSettings,
  run,
  now = Date.now,
  readAssistantSettings = async () => ({ exists: false }),
) {
  const app = express();
  registerPublicSettingsRoute(app, () => ({
    doc: (path) => {
      if (path === "settings/store") return { get: readSettings };
      if (path === "settings/assistant") return { get: readAssistantSettings };
      assert.fail(`Unexpected settings path: ${path}`);
    },
  }), now);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });

  try {
    const address = server.address();
    await run(`http://127.0.0.1:${address.port}/api/settings/public`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("public settings endpoint returns only launch-state information without reading store settings", async () => {
  const now = getLaunchTargetMs() - 1;
  await withPublicSettingsEndpoint(async () => {
    assert.fail("Public launch status must not read store settings.");
  }, async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      preLaunchEnabled: true,
      launchTime: PARTSWALA_LAUNCH_UTC,
      serverTimeUtc: new Date(now).toISOString(),
      millisecondsUntilLaunch: 1,
    });
  }, () => now, async () => {
    assert.fail("Assistant settings must not be read before launch.");
  });
});

test("public settings endpoint defaults safely when store settings are missing", async () => {
  const now = getLaunchTargetMs();
  await withPublicSettingsEndpoint(async () => ({ exists: false }), async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      preLaunchEnabled: false,
      launchTime: PARTSWALA_LAUNCH_UTC,
      serverTimeUtc: new Date(now).toISOString(),
      millisecondsUntilLaunch: 0,
    });
  }, () => now);
});

test("public settings remain open after the target instant", async () => {
  const now = getLaunchTargetMs() + 1;
  await withPublicSettingsEndpoint(async () => ({ exists: false }), async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.preLaunchEnabled, false);
    assert.equal(result.serverTimeUtc, new Date(now).toISOString());
    assert.equal(result.millisecondsUntilLaunch, 0);
  }, () => now);
});

test("public settings stay closed when trusted server time is unavailable", async () => {
  await withPublicSettingsEndpoint(async () => ({ exists: false }), async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      message: "Public site availability could not be verified.",
    });
  }, () => Number.NaN);
});

test("public assistant settings are launch-gated, no-store, and expose only the enabled flag", async () => {
  for (const [now, expectedStatus] of [
    [getLaunchTargetMs() - 1, 403],
    [getLaunchTargetMs(), 200],
    [getLaunchTargetMs() + 1, 200],
  ]) {
    await withPublicSettingsEndpoint(
      async () => ({ exists: false }),
      async (url) => {
        const response = await fetch(url.replace("/api/settings/public", "/api/settings/assistant/public"));
        assert.equal(response.status, expectedStatus);
        assert.equal(response.headers.get("cache-control"), "no-store");
        if (expectedStatus === 200) {
          assert.deepEqual(await response.json(), { enabled: false });
        }
      },
      () => now,
      async () => ({
        exists: true,
        data: () => ({
          enabled: false,
          supportPhone: "private-marker",
          businessInformation: "private-settings-marker",
        }),
      }),
    );
  }
});

test("public assistant settings fail closed when authoritative time is invalid", async () => {
  await withPublicSettingsEndpoint(
    async () => ({ exists: false }),
    async (url) => {
      const response = await fetch(url.replace("/api/settings/public", "/api/settings/assistant/public"));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
    },
    () => Number.NaN,
    async () => assert.fail("Assistant settings must not be read when trusted time is unavailable."),
  );
});

test("public settings reject non-integer or unrepresentable trusted server time", async () => {
  for (const invalidTime of [
    undefined,
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    8_640_000_000_000_001,
    -8_640_000_000_000_001,
    new Date("invalid").getTime(),
    getLaunchTargetMs() - 0.5,
  ]) {
    await withPublicSettingsEndpoint(async () => ({ exists: false }), async (url) => {
      const response = await fetch(url);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), {
        message: "Public site availability could not be verified.",
      });
    }, () => invalidTime);
  }
});
