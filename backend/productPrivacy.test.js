import assert from "node:assert/strict";
import test from "node:test";
import {
  productUpdateWithoutPrivateFields,
  sanitizePublicProduct,
  serializePublicProduct,
  VENDOR_PRIVATE_PRODUCT_FIELDS,
} from "./productPrivacy.js";

test("new public product data excludes vendor-private fields without mutating its input", () => {
  const input = {
    name: "Synthetic part",
    vendorAddress: "Private synthetic address",
    vendorGstin: "PRIVATE-GSTIN",
    vendorState: "Private synthetic state",
  };

  const product = sanitizePublicProduct(input);

  assert.deepEqual(product, { name: "Synthetic part" });
  assert.equal(input.vendorAddress, "Private synthetic address");
});

test("public product updates remove previously stored and newly supplied vendor-private fields", () => {
  const input = {
    name: "Updated synthetic part",
    vendorAddress: "New private synthetic address",
    vendorGstin: "NEW-PRIVATE-GSTIN",
    vendorState: "New private synthetic state",
  };
  const deleteFieldValue = Symbol("delete-field");

  const update = productUpdateWithoutPrivateFields(input, deleteFieldValue);

  assert.equal(update.name, "Updated synthetic part");
  for (const field of VENDOR_PRIVATE_PRODUCT_FIELDS) {
    assert.equal(update[field], deleteFieldValue);
  }
  assert.equal(input.vendorAddress, "New private synthetic address");
});

test("public product serialization exposes only approved fields and safe nested data", () => {
  const product = serializePublicProduct({
    id: "part-1",
    name: "Synthetic part",
    price: 250,
    sellerType: "vendor",
    sellerId: "vendor-1",
    images: ["https://images.example/part.jpg", 12],
    dimensions: { length: 10, width: 20, height: 30, vendorAddress: "private" },
    vendorGstin: "PRIVATE-GSTIN",
    vendorAddress: "Private synthetic address",
    email: "private@example.test",
    unknownInternalFlag: true,
  });

  assert.deepEqual(product, {
    id: "part-1",
    name: "Synthetic part",
    price: 250,
    sellerType: "vendor",
    sellerId: "vendor-1",
    images: ["https://images.example/part.jpg"],
    dimensions: { length: 10, width: 20, height: 30 },
  });
});
