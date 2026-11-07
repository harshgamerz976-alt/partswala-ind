import assert from "node:assert/strict";
import test from "node:test";
import { getProductSearchFromUrl } from "./productSearch.js";

test("product search reads and trims the URL search query", () => {
  assert.equal(getProductSearchFromUrl("?search=%20clutch%20"), "clutch");
  assert.equal(getProductSearchFromUrl("?page=2&search=brake"), "brake");
  assert.equal(getProductSearchFromUrl("?search=%20"), "");
  assert.equal(getProductSearchFromUrl(""), "");
});
