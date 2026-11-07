import test from "node:test";
import assert from "node:assert/strict";
import {
  getLaunchTargetMs,
  isLaunchWindowOpen,
  PARTSWALA_LAUNCH_UTC,
  getPreLaunchRouteSurface,
  isValidServerTimestamp,
  LAUNCH_STATUS_REFRESH_INTERVAL_MS,
  scheduleLaunchStatusRefresh,
  shouldShowComingSoon,
} from "../shared/preLaunch.js";
import { isMarketplaceAvailable } from "./marketplaceLaunch.js";

const launchTime = Date.parse(PARTSWALA_LAUNCH_UTC);
const oneMillisecondBeforeLaunch = launchTime - 1;
const oneMillisecondAfterLaunch = launchTime + 1;

test("server timestamps must fit within JavaScript's valid Date range", () => {
  assert.equal(isValidServerTimestamp(8_640_000_000_000_000), true);
  assert.equal(isValidServerTimestamp(-8_640_000_000_000_000), true);
  for (const invalidTime of [
    Number.MAX_SAFE_INTEGER,
    Number.MIN_SAFE_INTEGER,
    8_640_000_000_000_001,
    -8_640_000_000_000_001,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    new Date("invalid").getTime(),
    undefined,
    null,
    getLaunchTargetMs() - 0.5,
  ]) {
    assert.equal(isValidServerTimestamp(invalidTime), false, String(invalidTime));
  }
});

test("pre-launch mode hides the storefront from non-admin visitors before the scheduled launch", () => {
  assert.equal(shouldShowComingSoon(true, false), true);
  assert.equal(shouldShowComingSoon(null, false), true);
  assert.equal(shouldShowComingSoon(undefined, false), true);
});

test("authorized admins retain storefront access regardless of launch timing", () => {
  assert.equal(shouldShowComingSoon(true, true), false);
  assert.equal(shouldShowComingSoon(undefined, true), false);
});

test("the frontend waits for authoritative launch status even if the device clock is at or after launch", () => {
  assert.equal(shouldShowComingSoon(true, false), true);
  assert.equal(shouldShowComingSoon(null, false), true);
  assert.equal(shouldShowComingSoon(false, false), false);
});

test("the launch gate is closed one millisecond before the target", () => {
  assert.equal(getLaunchTargetMs(), launchTime);
  assert.equal(isLaunchWindowOpen(oneMillisecondBeforeLaunch), false);
  assert.equal(isMarketplaceAvailable({ now: oneMillisecondBeforeLaunch }), false);
});

test("the launch gate opens exactly at the target", () => {
  assert.equal(isLaunchWindowOpen(launchTime), true);
  assert.equal(isMarketplaceAvailable({ now: launchTime }), true);
});

test("the launch gate remains open one millisecond after the target", () => {
  assert.equal(isLaunchWindowOpen(oneMillisecondAfterLaunch), true);
  assert.equal(isMarketplaceAvailable({ now: oneMillisecondAfterLaunch }), true);
});

test("an unknown authoritative time fails closed; only an authorized admin can use the admin exception", () => {
  for (const now of [
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
    assert.equal(isLaunchWindowOpen(now), false);
    assert.equal(isMarketplaceAvailable({ now }), false);
    assert.equal(isMarketplaceAvailable({ now, isAdmin: true }), false);
    assert.equal(isMarketplaceAvailable({ now, isAdmin: true, allowAdmin: true }), false);
  }
});

test("launch status refresh polls at a fixed interval without using countdown time", () => {
  const scheduledTimers = [];
  let refreshed = 0;
  scheduleLaunchStatusRefresh(() => { refreshed += 1; }, {
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay };
      scheduledTimers.push(timer);
      return timer;
    },
    clearTimeoutFn: () => {},
  });

  assert.equal(scheduledTimers[0].delay, LAUNCH_STATUS_REFRESH_INTERVAL_MS);
  assert.equal(refreshed, 0);
  scheduledTimers[0].callback();
  assert.equal(refreshed, 1);
});

test("unmounting the launch gate cancels its pending timer", () => {
  let scheduledCallback;
  let scheduledId;
  let clearedId;
  let opened = false;
  const cancel = scheduleLaunchStatusRefresh(() => { opened = true; }, {
    setTimeoutFn: (callback) => {
      scheduledCallback = callback;
      scheduledId = { timer: true };
      return scheduledId;
    },
    clearTimeoutFn: (id) => { clearedId = id; },
  });

  cancel();
  scheduledCallback();
  assert.equal(clearedId, scheduledId);
  assert.equal(opened, false);
});

test("local development bypasses the launch gate without changing production behavior", () => {
  assert.equal(shouldShowComingSoon(true, false, true), false);
  assert.equal(shouldShowComingSoon(null, false, true), false);
  assert.equal(shouldShowComingSoon(true, false), true);
});

test("pre-launch routes allow only approved vendor workspace pages and vendor sign-in", () => {
  assert.equal(getPreLaunchRouteSurface("/vendor/login", false), "vendor-login");
  for (const route of ["/profile", "/vendor", "/vendor/dashboard", "/vendor/enquiries", "/vendor/import"]) {
    assert.equal(getPreLaunchRouteSurface(route, true), "vendor");
    for (const deniedVendor of [false, null, undefined]) {
      assert.equal(getPreLaunchRouteSurface(route, deniedVendor), "coming-soon");
    }
  }
  for (const route of ["/", "/products", "/products/private", "/cart", "/checkout", "/vendor/unknown"]) {
    assert.equal(getPreLaunchRouteSurface(route, true), "coming-soon");
  }
});
