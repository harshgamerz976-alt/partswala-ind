import test from "node:test";
import assert from "node:assert/strict";
import { resolveLegacySellerOwnership } from "./sellerOwnership.js";

test("legacy ownership follows the current vendor-product link on every resolution", async () => {
  let currentLinks = [{ productId: "product-1", vendorId: "vendor-a" }];
  let loads = 0;
  const loadCurrentLinks = async (productIds) => {
    loads += 1;
    assert.deepEqual(productIds, ["product-1", "product-2"]);
    return currentLinks;
  };

  assert.deepEqual(
    [...await resolveLegacySellerOwnership(["product-1", "product-2"], loadCurrentLinks)],
    [["product-1", { sellerId: "vendor-a", sellerType: "vendor" }]],
  );

  currentLinks = [
    { productId: "product-1", vendorId: "vendor-b" },
    { productId: "product-2", vendorId: "vendor-c" },
  ];
  assert.deepEqual(
    [...await resolveLegacySellerOwnership(["product-1", "product-2"], loadCurrentLinks)],
    [
      ["product-1", { sellerId: "vendor-b", sellerType: "vendor" }],
      ["product-2", { sellerId: "vendor-c", sellerType: "vendor" }],
    ],
  );
  assert.equal(loads, 2);
});

test("legacy products without a current vendor link stay PARTSWALA-owned by default", async () => {
  const ownership = await resolveLegacySellerOwnership(["product-1"], async () => []);
  assert.equal(ownership.has("product-1"), false);
});