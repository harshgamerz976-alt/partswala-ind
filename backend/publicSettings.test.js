import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerPublicSettingsRoute } from "./publicSettings.js";

async function withPublicSettingsEndpoint(readSettings, run) {
  const app = express();
  registerPublicSettingsRoute(app, () => ({
    doc: (path) => {
      assert.equal(path, "settings/store");
      return { get: readSettings };
    },
  }));

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

test("public settings endpoint returns only public settings without caching", async () => {
  await withPublicSettingsEndpoint(async () => ({
    exists: true,
    data: () => ({
      preLaunchEnabled: true,
      comingSoonVideoUrl: "https://example.test/launch.mp4",
      razorpayKeySecret: "must-not-be-returned",
      adminNotes: "must-not-be-returned",
    }),
  }), async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      preLaunchEnabled: true,
      comingSoonVideoUrl: "https://example.test/launch.mp4",
    });
  });
});

test("public settings endpoint defaults safely when store settings are missing", async () => {
  await withPublicSettingsEndpoint(async () => ({ exists: false }), async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      preLaunchEnabled: false,
      comingSoonVideoUrl: "",
    });
  });
});

test("public settings endpoint reports Firestore failures without exposing details", async () => {
  await withPublicSettingsEndpoint(async () => {
    const error = new Error("private backend detail");
    error.code = "permission-denied";
    throw error;
  }, async (url) => {
    const response = await fetch(url);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      message: "Public site settings could not be loaded.",
    });
  });
});
