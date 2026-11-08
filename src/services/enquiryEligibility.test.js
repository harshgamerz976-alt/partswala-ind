import assert from "node:assert/strict";
import test from "node:test";
import { canSubmitSupplierEnquiry } from "./enquiryEligibility.js";

test("supplier enquiry UI waits for an explicit eligible customer or approved vendor profile", () => {
  assert.equal(canSubmitSupplierEnquiry({ profile: null, loading: true }), false);
  assert.equal(canSubmitSupplierEnquiry({ profile: null }), false);
  assert.equal(canSubmitSupplierEnquiry({ profile: { role: "customer" } }), true);
  assert.equal(canSubmitSupplierEnquiry({
    profile: { role: "vendor", vendorStatus: "approved" },
  }), true);
  assert.equal(canSubmitSupplierEnquiry({
    profile: { role: "vendor", vendorStatus: "pending" },
  }), false);
  assert.equal(canSubmitSupplierEnquiry({
    profile: { role: "admin" },
    isAdmin: true,
  }), false);
});
