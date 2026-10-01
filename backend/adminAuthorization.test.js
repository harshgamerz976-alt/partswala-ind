import test from "node:test";
import assert from "node:assert/strict";
import { hasAdminClaim } from "./adminAuthorization.js";

test("the three configured admin emails and Firebase admin claims grant admin authorization", () => {
  assert.equal(hasAdminClaim({ uid: "admin-1", admin: true }), true);
  for (const email of ["kripaldiamond@gmail.com", "harshgamerz976@gmail.com", "partswalaind@gmail.com"]) {
    assert.equal(hasAdminClaim({ uid: "admin-email", email }), true);
    assert.equal(hasAdminClaim({ uid: "admin-email-uppercase", email: email.toUpperCase() }), true);
  }
  assert.equal(hasAdminClaim({ uid: "customer", email: "customer@example.com", email_verified: true }), false);
  assert.equal(hasAdminClaim({ uid: "vendor", email: "vendor@example.com", role: "vendor", email_verified: true }), false);
  assert.equal(hasAdminClaim({ uid: "user-1", email: "admin@example.com", email_verified: true }), false);
  assert.equal(hasAdminClaim({ uid: "user-1", isAdmin: true }), false);
  assert.equal(hasAdminClaim(null), false);
});
