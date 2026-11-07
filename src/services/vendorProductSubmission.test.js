import assert from "node:assert/strict";
import test from "node:test";
import { getVendorProductSubmissionError, MAX_VENDOR_PRODUCT_IMAGES } from "./vendorProductSubmission.js";

const validProduct = {
  partNumber: "PART-100",
  price: "90",
  mrp: "100",
  stock: "2",
  weight: "1",
  length: "",
  width: "",
  height: "",
};

test("valid catalogue submissions do not require a shipping pickup address", () => {
  assert.equal(getVendorProductSubmissionError(validProduct, 1), "");
});

test("product submissions keep required product, weight, and image validation", () => {
  assert.match(getVendorProductSubmissionError({ ...validProduct, partNumber: "" }, 1), /Part number/);
  assert.match(getVendorProductSubmissionError({ ...validProduct, weight: "0" }, 1), /positive product weight/);
  assert.match(getVendorProductSubmissionError(validProduct, 0), /at least one product image/);
  assert.match(getVendorProductSubmissionError(validProduct, MAX_VENDOR_PRODUCT_IMAGES + 1), /at most 5 images/);
  assert.match(getVendorProductSubmissionError({ ...validProduct, price: "-1" }, 1), /non-negative numbers/);
});
