import test from "node:test";
import assert from "node:assert/strict";
import { validateVendorProductImageFile } from "./vendorProductImageValidation.js";

test("vendor image selection accepts supported formats within the size limit", () => {
  assert.doesNotThrow(() => validateVendorProductImageFile({
    name: "part.JPG",
    type: "image/jpeg",
    size: 1024,
  }));
});

test("vendor image selection rejects mismatched, unsupported, empty, and oversized files", () => {
  assert.throws(() => validateVendorProductImageFile({ name: "part.png", type: "image/jpeg", size: 100 }), /supported/i);
  assert.throws(() => validateVendorProductImageFile({ name: "part.svg", type: "image/svg+xml", size: 100 }), /supported/i);
  assert.throws(() => validateVendorProductImageFile({ name: "part.png", type: "image/png", size: 0 }), /valid image/i);
  assert.throws(() => validateVendorProductImageFile({ name: "part.png", type: "image/png", size: 5 * 1024 * 1024 + 1 }), /5 MB/i);
});
