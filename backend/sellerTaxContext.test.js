import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIndianState, resolveSellerTaxState, validatedDeliveryState } from "./sellerTaxContext.js";

test("Indian states canonicalize recognized names and reject unknown values", () => {
  assert.equal(normalizeIndianState(" nct of Delhi "), "Delhi");
  assert.equal(normalizeIndianState("Orissa"), "Odisha");
  assert.equal(normalizeIndianState("not a state"), null);
  assert.equal(validatedDeliveryState("Tamil Nadu"), "Tamil Nadu");
  assert.throws(() => validatedDeliveryState("Unknown State"), /valid Indian delivery state/);
});

test("vendor tax state comes only from the private vendor profile, not product or pickup state", () => {
  const resolved = resolveSellerTaxState({
    product: { sellerType: "vendor", sellerId: "vendor-a", vendorName: "Vendor A", sellerState: "Maharashtra", vendorState: "Maharashtra" },
    vendorProfile: { state: "Gujarat" },
    partswalaState: "Maharashtra",
  });
  assert.equal(resolved, "Gujarat");
});

test("seller state resolution fails closed for missing vendor and PARTSWALA registration state", () => {
  assert.throws(() => resolveSellerTaxState({ product: { sellerType: "vendor", sellerId: "vendor-b" }, vendorProfile: { pickupLocation: { state: "Gujarat" } }, partswalaState: "Maharashtra" }), /Vendor vendor-b is missing a registered business\/GST state/);
  assert.throws(() => resolveSellerTaxState({ product: { sellerType: "partswala" }, partswalaState: "" }), /PARTSWALA's registered business\/GST state is missing/);
});

test("PARTSWALA-owned product state comes from PARTSWALA registration, not product fields", () => {
  assert.equal(resolveSellerTaxState({
    product: { sellerType: "partswala", sellerState: "Gujarat", vendorState: "Gujarat" },
    partswalaState: "Maharashtra",
  }), "Maharashtra");
});