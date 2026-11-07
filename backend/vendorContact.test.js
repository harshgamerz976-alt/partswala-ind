import assert from "node:assert/strict";
import test from "node:test";
import { getExplicitPublicVendorWhatsAppNumber } from "./vendorContact.js";

test("vendor WhatsApp disclosure uses only explicitly public contact fields", () => {
  assert.equal(getExplicitPublicVendorWhatsAppNumber(
    { whatsAppNumber: "private-product-number", vendorWhatsAppNumber: "private-vendor-number" },
    { whatsAppNumber: "private-profile-number" },
  ), null);
  assert.equal(getExplicitPublicVendorWhatsAppNumber(
    { publicWhatsAppNumber: "9876543210" },
    { publicWhatsAppNumber: "919999999999" },
  ), "919876543210");
  assert.equal(getExplicitPublicVendorWhatsAppNumber(
    {},
    { publicWhatsAppNumber: "919876543210" },
  ), "919876543210");
  assert.equal(getExplicitPublicVendorWhatsAppNumber(
    { publicWhatsAppNumber: "not-a-number" },
    {},
  ), null);
});
