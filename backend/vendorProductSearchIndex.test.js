import assert from "node:assert/strict";
import test from "node:test";
import {
  isCompletedVendorApplicationDecision,
  refreshVendorProductSearchIndex,
} from "./vendorProductSearchIndex.js";
import { searchCandidateNgram } from "./publicProductCatalogIndex.js";

function makeDatabase(products, { failAfterApplyOnCommits = [] } = {}) {
  const rows = new Map(products.map((product) => [product.id, { ...product }]));
  const failedCommits = new Set(failAfterApplyOnCommits);
  const stats = { queries: 0, commits: 0 };

  function snapshot(id) {
    const row = rows.get(id);
    return {
      id,
      ref: { id },
      data: () => ({ ...row }),
    };
  }

  return {
    rows,
    stats,
    collection(name) {
      assert.equal(name, "products");
      return {
        where(field, _operator, value) {
          return {
            async get() {
              stats.queries += 1;
              const fieldValue = (row) => field.split(".").reduce((current, key) => current?.[key], row);
              return {
                docs: [...rows.entries()]
                  .filter(([, row]) => fieldValue(row) === value)
                  .map(([id]) => snapshot(id)),
              };
            },
          };
        },
      };
    },
    batch() {
      const writes = [];
      return {
        update(reference, fields) {
          writes.push({ id: reference.id, fields });
        },
        async commit() {
          stats.commits += 1;
          for (const { id, fields } of writes) Object.assign(rows.get(id), fields);
          if (failedCommits.delete(stats.commits)) {
            const error = new Error("Transient Firestore commit failure");
            error.code = "unavailable";
            throw error;
          }
        },
      };
    },
  };
}

function vendorProduct(id, overrides = {}) {
  return {
    id,
    sellerId: "vendor-1",
    sellerType: "vendor",
    name: `Part ${id}`,
    price: 250,
    enabled: true,
    status: "Available",
    vendorName: "Old Supplier",
    vendorBusinessName: "Old Supplier",
    catalogVendorBusinessName: "Old Supplier",
    ...overrides,
  };
}

const approvedVendor = {
  role: "vendor",
  vendorStatus: "approved",
  vendorProfile: { businessName: "Current Supplier" },
};

test("refresh retries after a partially committed batch and is safe to rerun", async () => {
  const products = Array.from({ length: 21 }, (_, index) => vendorProduct(`product-${index}`));
  products[0].vendorId = "vendor-1";
  const database = makeDatabase(products, { failAfterApplyOnCommits: [2] });

  const refreshed = await refreshVendorProductSearchIndex(database, "vendor-1", approvedVendor);

  assert.equal(refreshed, 21);
  assert.equal(database.stats.commits, 4);
  for (const product of database.rows.values()) {
    assert.equal(product.catalogVendorBusinessName, "Current Supplier");
    assert.ok(product.catalogSearchNgrams.includes(searchCandidateNgram("current")));
    assert.equal(product.catalogSearchNgrams.includes(searchCandidateNgram("old")), false);
  }

  const commitsBeforeRerun = database.stats.commits;
  assert.equal(await refreshVendorProductSearchIndex(database, "vendor-1", approvedVendor), 21);
  assert.equal(database.stats.commits - commitsBeforeRerun, 2);
});

test("refresh completes successfully and ignores products owned by other or non-vendor sellers", async () => {
  const database = makeDatabase([
    vendorProduct("vendor-product"),
    vendorProduct("other-vendor-product", { sellerId: "vendor-2" }),
    vendorProduct("non-vendor-product", { sellerType: "partswala" }),
  ]);

  assert.equal(await refreshVendorProductSearchIndex(database, "vendor-1", approvedVendor), 1);
  assert.equal(database.rows.get("vendor-product").catalogVendorBusinessName, "Current Supplier");
  assert.equal(database.rows.get("other-vendor-product").catalogVendorBusinessName, "Old Supplier");
  assert.equal(database.rows.get("non-vendor-product").catalogVendorBusinessName, "Old Supplier");
  assert.equal(database.stats.commits, 1);
});

test("retry exhaustion has context and preserves the Firestore cause; a later run can recover", async () => {
  const database = makeDatabase(
    [vendorProduct("vendor-product")],
    { failAfterApplyOnCommits: [1, 2, 3] },
  );

  let finalFirestoreError;
  await assert.rejects(
    refreshVendorProductSearchIndex(database, "vendor-1", approvedVendor),
    (error) => {
      assert.equal(error.message, "Vendor product search-index refresh failed after 3 attempts.");
      assert.equal(error.code, "VENDOR_PRODUCT_SEARCH_INDEX_REFRESH_FAILED");
      assert.equal(error.attempts, 3);
      assert.equal(error.cause?.message, "Transient Firestore commit failure");
      assert.equal(error.cause?.code, "unavailable");
      finalFirestoreError = error.cause;
      return true;
    },
  );
  assert.equal(await refreshVendorProductSearchIndex(database, "vendor-1", approvedVendor), 1);
  assert.equal(database.rows.get("vendor-product").catalogVendorBusinessName, "Current Supplier");
  assert.equal(database.stats.commits, 4);
  assert.ok(finalFirestoreError);
});

test("completed application decisions are retryable only while vendor status agrees", () => {
  assert.equal(isCompletedVendorApplicationDecision("approved", { status: "approved" }, {
    role: "vendor",
    vendorStatus: "approved",
  }), true);
  assert.equal(isCompletedVendorApplicationDecision("rejected", { status: "rejected" }, {
    role: "vendor",
    vendorStatus: "rejected",
  }), true);
  assert.equal(isCompletedVendorApplicationDecision("approved", { status: "rejected" }, {
    role: "vendor",
    vendorStatus: "approved",
  }), false);
  assert.equal(isCompletedVendorApplicationDecision("rejected", { status: "rejected" }, {
    role: "vendor",
    vendorStatus: "approved",
  }), false);
});
