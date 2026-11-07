import assert from "node:assert/strict";
import test from "node:test";
import { getKnownProductStock, getProductTaxLabel } from "./productPresentation.js";

test("product stock is shown only when the listing contains a valid non-negative value", () => {
  assert.equal(getKnownProductStock({ stock: 0 }), 0);
  assert.equal(getKnownProductStock({ stock: 4 }), 4);
  assert.equal(getKnownProductStock({ stock: "7" }), 7);
  assert.equal(getKnownProductStock({ stockCount: 2 }), 2);
  assert.equal(getKnownProductStock({}), null);
  assert.equal(getKnownProductStock({ stock: null }), null);
  assert.equal(getKnownProductStock({ stock: "" }), null);
  assert.equal(getKnownProductStock({ stock: -1 }), null);
  assert.equal(getKnownProductStock({ stock: Number.NaN }), null);
});

test("product tax labels require an explicit inclusion setting", () => {
  assert.equal(getProductTaxLabel(true), "Inclusive of applicable taxes");
  assert.equal(getProductTaxLabel(false), "Before applicable GST");
  assert.equal(getProductTaxLabel(undefined), "Tax treatment to confirm with supplier");
  assert.equal(getProductTaxLabel(null), "Tax treatment to confirm with supplier");
});
