import test from "node:test";
import assert from "node:assert/strict";
import { shouldShowComingSoon } from "../shared/preLaunch.js";

test("pre-launch mode hides the storefront from non-admin visitors", () => {
  assert.equal(shouldShowComingSoon(true, false), true);
  assert.equal(shouldShowComingSoon(true, null), true);
});

test("an unverified launch setting keeps the storefront closed to non-admin visitors", () => {
  assert.equal(shouldShowComingSoon(null, false), true);
  assert.equal(shouldShowComingSoon(undefined, false), true);
});

test("an authorized admin has the intentional recovery path when public settings fail", () => {
  assert.equal(shouldShowComingSoon(null, true), false);
  assert.equal(shouldShowComingSoon(undefined, true), false);
});

test("authorized admins retain storefront access while pre-launch mode is enabled", () => {
  assert.equal(shouldShowComingSoon(true, true), false);
  assert.equal(shouldShowComingSoon(null, true), false);
});

test("the storefront remains available when pre-launch mode is disabled", () => {
  assert.equal(shouldShowComingSoon(false, false), false);
});

test("local development bypasses pre-launch mode without changing production behavior", () => {
  assert.equal(shouldShowComingSoon(true, false, true), false);
  assert.equal(shouldShowComingSoon(null, false, true), false);
  assert.equal(shouldShowComingSoon(true, false, false), true);
});
