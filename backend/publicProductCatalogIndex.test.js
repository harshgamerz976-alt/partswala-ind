import assert from "node:assert/strict";
import test from "node:test";
import {
  publicProductCatalogIndexFields,
  publicProductCatalogIndexUpdate,
  resolveCatalogVendorBusinessName,
  catalogCandidateSearch,
  searchCandidateNgram,
  searchIndexNgrams,
} from "./publicProductCatalogIndex.js";

test("catalogue search index includes matching substrings and query grams", () => {
  const fields = publicProductCatalogIndexFields("part-1", {
    name: "Front Brake Pad",
    category: "Brakes",
    compatibility: "Tata 1612",
    price: 250,
    enabled: true,
    status: "Available",
  });
  assert.equal(fields.catalogEligible, true);
  assert.equal(fields.catalogCategory, "brakes");
  assert.equal(fields.catalogAvailability, "unknown");
  assert.ok(fields.catalogSearchNgrams.includes(searchCandidateNgram("brake")));
  assert.ok(fields.catalogSearchNgrams.includes(searchCandidateNgram("tata")));
  assert.ok(searchIndexNgrams("ab").includes("ab"));
  assert.equal(catalogCandidateSearch({ search: "br", compatibility: "Tata 1612" }), "Tata 1612");
});

test("catalogue search index includes approved profile business names absent from products", () => {
  const approvedVendor = {
    role: "vendor",
    vendorStatus: "approved",
    vendorProfile: { businessName: "Approved Profile Supplier" },
  };
  const fields = publicProductCatalogIndexFields("part-1", {
    name: "Front Brake Pad",
    sellerType: "vendor",
    sellerId: "vendor-1",
    price: 250,
    enabled: true,
    status: "Available",
  }, approvedVendor);

  assert.equal(fields.catalogVendorBusinessName, "Approved Profile Supplier");
  assert.ok(fields.catalogSearchNgrams.includes(searchCandidateNgram("profile")));
});

test("catalogue index replaces an old vendor name with the currently approved profile name", () => {
  const product = {
    name: "Brake pad",
    price: 250,
    enabled: true,
    status: "Available",
    sellerType: "vendor",
    sellerId: "vendor-1",
    vendorName: "Old Supplier",
    vendorBusinessName: "Old Supplier",
    catalogVendorBusinessName: "Old Supplier",
  };
  const approvedVendor = {
    role: "vendor",
    vendorStatus: "approved",
    vendorProfile: { businessName: "New Supplier" },
  };
  const fields = publicProductCatalogIndexUpdate("part-1", product, { stock: 3 }, approvedVendor);

  assert.equal(fields.catalogVendorBusinessName, "New Supplier");
  assert.ok(fields.catalogSearchNgrams.includes(searchCandidateNgram("new")));
  assert.equal(fields.catalogSearchNgrams.includes(searchCandidateNgram("old")), false);
});

test("catalogue index uses the approved profile name when a vendor becomes approved", () => {
  const product = {
    name: "Brake pad",
    price: 250,
    enabled: true,
    status: "Available",
    sellerType: "vendor",
    sellerId: "vendor-1",
    vendorBusinessName: "Stale Product Name",
    catalogVendorBusinessName: "Stale Indexed Name",
  };
  const fields = publicProductCatalogIndexUpdate("part-1", product, { enabled: true }, {
    role: "vendor",
    vendorStatus: "approved",
    vendorProfile: { businessName: "Approved Profile Name" },
  });

  assert.equal(fields.catalogVendorBusinessName, "Approved Profile Name");
  assert.ok(fields.catalogSearchNgrams.includes(searchCandidateNgram("approved")));
  assert.equal(fields.catalogSearchNgrams.includes(searchCandidateNgram("stale")), false);
});

test("catalogue index removes profile names when vendor approval is revoked", () => {
  const product = {
    name: "Brake pad",
    price: 250,
    enabled: true,
    status: "Available",
    sellerType: "vendor",
    sellerId: "vendor-1",
    vendorBusinessName: "Revoked Supplier",
    vendorName: "Revoked Supplier",
    vendorProfile: { businessName: "Revoked Supplier" },
    catalogVendorBusinessName: "Revoked Supplier",
  };
  const revokedVendor = {
    role: "vendor",
    vendorStatus: "rejected",
    vendorProfile: { businessName: "Revoked Supplier" },
  };
  const fields = publicProductCatalogIndexUpdate("part-1", product, { stock: 3 }, revokedVendor);

  assert.equal(resolveCatalogVendorBusinessName(product, revokedVendor), "");
  assert.equal(fields.catalogVendorBusinessName, "");
  assert.equal(fields.catalogSearchNgrams.includes(searchCandidateNgram("revoked")), false);
});

test("catalogue search n-grams stay under the Firestore per-document entry budget", () => {
  const longText = Array.from({ length: 10000 }, (_, index) => String.fromCodePoint(0x1000 + index)).join("");
  const ngrams = searchIndexNgrams(longText);
  assert.equal(ngrams.length, 6000);
});

test("catalogue index updates follow publication and availability changes", () => {
  const current = {
    name: "Brake pad",
    price: 250,
    stock: 5,
    enabled: true,
    status: "Available",
  };
  const unavailable = publicProductCatalogIndexUpdate("part-1", current, { stock: 0 });
  assert.equal(unavailable.catalogEligible, true);
  assert.equal(unavailable.stock, 0);
  assert.equal(unavailable.catalogAvailability, "out-of-stock");

  const disabled = publicProductCatalogIndexUpdate("part-1", current, { enabled: false, status: "Disabled" });
  assert.equal(disabled.catalogEligible, false);

  const vendorProduct = {
    ...current,
    sellerType: "vendor",
    sellerId: "vendor-1",
    catalogVendorBusinessName: "Approved Profile Supplier",
  };
  const stockUpdate = publicProductCatalogIndexUpdate("part-2", vendorProduct, { stock: 0 });
  assert.equal(stockUpdate.catalogVendorBusinessName, "Approved Profile Supplier");
  assert.ok(stockUpdate.catalogSearchNgrams.includes(searchCandidateNgram("profile")));
});
