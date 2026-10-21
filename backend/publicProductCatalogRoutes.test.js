import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { registerPublicProductCatalogRoutes } from "./publicProductCatalogRoutes.js";

function makeDocument(id, data) {
  return {
    id,
    exists: Boolean(data),
    data: () => data,
  };
}

function makeDatabase(products, vendors, vendorLinks = new Map()) {
  function productDocument(id) {
    return makeDocument(id, products.get(id));
  }

  return {
    collection(name) {
      if (name === "users") {
        return { doc: (id) => ({ collectionName: name, id }) };
      }
      if (name === "vendorProductLinks") {
        return {
          where(_field, _operator, productIds) {
            return {
              async get() {
                const docs = [...vendorLinks]
                  .filter(([productId]) => productIds.includes(productId))
                  .map(([productId, vendorId]) => ({
                    id: productId,
                    data: () => ({ productId, vendorId }),
                  }));
                return { docs };
              },
            };
          },
        };
      }
      let cursor = "";
      let pageLimit = 100;
      let categoryFilter = "";
      const orderedQuery = {
        where(_field, _operator, value) {
          categoryFilter = value;
          return this;
        },
        orderBy() {
          return this;
        },
        startAfter(value) {
          cursor = typeof value === "string" ? value : value.id;
          return this;
        },
        limit(value) {
          pageLimit = value;
          return this;
        },
        async get() {
          const orderedIds = [...products.keys()]
            .filter((id) => !categoryFilter || products.get(id)?.category === categoryFilter)
            .sort((leftId, rightId) => categoryFilter
              ? leftId.localeCompare(rightId)
              : (Date.parse(products.get(rightId)?.createdAt || "") || 0)
                - (Date.parse(products.get(leftId)?.createdAt || "") || 0)
                || rightId.localeCompare(leftId));
          const cursorIndex = cursor ? orderedIds.indexOf(cursor) : -1;
          const docs = orderedIds.slice(cursorIndex + 1, cursorIndex + 1 + pageLimit).map(productDocument);
          return { docs, size: docs.length };
        },
      };
      return {
        ...orderedQuery,
        doc: (id) => ({
          collectionName: name,
          id,
          async get() {
            return productDocument(id);
          },
        }),
      };
    },
    async getAll(...references) {
      return references.map(({ collectionName, id }) => collectionName === "users"
        ? makeDocument(id, vendors.get(id))
        : productDocument(id));
    },
  };
}

async function startCatalogApi(database, resolveClientIp = () => "catalog-test") {
  const app = express();
  app.use(express.json());
  registerPublicProductCatalogRoutes(app, {
    getDb: () => database,
    resolveClientIp,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

const approvedVendor = {
  role: "vendor",
  vendorStatus: "approved",
  vendorProfile: { businessName: "Approved Parts" },
};
const pendingVendor = { role: "vendor", vendorStatus: "pending" };
const publicFields = {
  name: "Synthetic public part",
  price: 2500,
  createdAt: "2026-01-01T00:00:00.000Z",
  enabled: true,
  status: "Available",
};

test("catalogue list filters pending products/vendors, normalizes legacy vendor IDs, and sanitizes private fields", async (t) => {
  const products = new Map([
    ["approved", {
      ...publicFields,
      sellerType: "vendor",
      sellerId: "approved-vendor",
      vendorAddress: "private address",
      vendorGstin: "private GSTIN",
      vendorState: "private state",
      vendorPhone: "+911234567890",
      vendorEmail: "private@example.test",
      privatePhone: "+919876543210",
      privateEmail: "another-private@example.test",
      internalStatus: "not for storefront",
      status: "Available",
      costPrice: 1200,
      vendorBusinessName: "Untrusted product-supplied name",
      vendorProfile: { phone: "+919111111111", businessAddress: "private location" },
      dimensions: { length: 4, width: 3, privateNote: "not public" },
      images: ["https://images.example.test/part.jpg", { private: "not public" }],
    }],
    ["approved-legacy", {
      ...publicFields,
      vendorId: "approved-vendor",
    }],
    ["disabled", { ...publicFields, enabled: false }],
    ["pending-vendor", {
      ...publicFields,
      sellerType: "vendor",
      sellerId: "pending-vendor",
    }],
    ["pending-legacy-vendor", {
      ...publicFields,
      vendorType: "vendor",
      vendorId: "pending-vendor",
    }],
    ["pending-vendor-id-only", {
      ...publicFields,
      vendorId: "pending-vendor",
    }],
    ["pending-product", { ...publicFields, status: "pending" }],
  ]);
  const api = await startCatalogApi(makeDatabase(products, new Map([
    ["approved-vendor", approvedVendor],
    ["pending-vendor", pendingVendor],
  ])));
  t.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/public-products`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.products.map(({ id }) => id), ["approved-legacy", "approved"]);
  assert.deepEqual(
    Object.keys(result).sort(),
    ["hasMore", "products", "scanCursor"].sort(),
  );
  assert.equal(result.scanCursor, "approved");
  assert.equal(result.hasMore, false);
  const approvedProduct = result.products.find(({ id }) => id === "approved");
  assert.equal(approvedProduct.vendorBusinessName, "Approved Parts");
  assert.deepEqual(approvedProduct.dimensions, { length: 4, width: 3 });
  assert.deepEqual(approvedProduct.images, ["https://images.example.test/part.jpg"]);
  for (const field of [
    "vendorAddress",
    "vendorGstin",
    "vendorState",
    "vendorPhone",
    "vendorEmail",
    "privatePhone",
    "privateEmail",
    "internalStatus",
    "status",
    "costPrice",
    "sellerId",
    "vendorProfile",
    "vendorName",
    "soldBy",
  ]) {
    assert.equal(field in approvedProduct, false);
  }
});

test("catalogue list preserves newest-first ordering and resumes from an opaque product cursor", async (t) => {
  const products = new Map([
    ["oldest", { ...publicFields, createdAt: "2026-01-01T00:00:00.000Z" }],
    ["newest", { ...publicFields, createdAt: "2026-01-03T00:00:00.000Z" }],
    ["middle", { ...publicFields, createdAt: "2026-01-02T00:00:00.000Z" }],
  ]);
  const api = await startCatalogApi(makeDatabase(products, new Map()), () => "catalog-order-test");
  t.after(api.close);

  const first = await fetch(`${api.baseUrl}/api/public-products?limit=2`);
  assert.equal(first.status, 200);
  const firstPage = await first.json();
  assert.deepEqual(firstPage.products.map(({ id }) => id), ["newest", "middle"]);
  assert.equal(firstPage.scanCursor, "middle");
  assert.equal(firstPage.hasMore, true);

  const second = await fetch(`${api.baseUrl}/api/public-products?limit=2&after=middle`);
  assert.equal(second.status, 200);
  const secondPage = await second.json();
  assert.deepEqual(secondPage.products.map(({ id }) => id), ["oldest"]);
  assert.equal(secondPage.hasMore, false);
});
test("category catalogue pages filter server-side and retain stable cursors", async (t) => {
  const products = new Map([
    ["a-engine", { ...publicFields, category: "Engine" }],
    ["b-body", { ...publicFields, category: "Body" }],
    ["c-engine", { ...publicFields, category: "Engine" }],
  ]);
  const api = await startCatalogApi(makeDatabase(products, new Map()), () => "catalog-category-test");
  t.after(api.close);

  const first = await fetch(`${api.baseUrl}/api/public-products?category=Engine&limit=1`);
  assert.equal(first.status, 200);
  const firstPage = await first.json();
  assert.deepEqual(firstPage.products.map(({ id }) => id), ["a-engine"]);
  assert.equal(firstPage.hasMore, true);

  const second = await fetch(`${api.baseUrl}/api/public-products?category=Engine&limit=1&after=a-engine`);
  assert.equal(second.status, 200);
  const secondPage = await second.json();
  assert.deepEqual(secondPage.products.map(({ id }) => id), ["c-engine"]);
  assert.equal(secondPage.hasMore, true);

  const last = await fetch(`${api.baseUrl}/api/public-products?category=Engine&limit=1&after=c-engine`);
  assert.equal(last.status, 200);
  const lastPage = await last.json();
  assert.deepEqual(lastPage.products, []);
  assert.equal(lastPage.hasMore, false);
});
test("by-IDs and detail routes return only approved public products", async (t) => {
  const products = new Map([
    ["approved", { ...publicFields, sellerType: "vendor", sellerId: "approved-vendor" }],
    ["pending", { ...publicFields, sellerType: "vendor", sellerId: "pending-vendor" }],
  ]);
  const api = await startCatalogApi(makeDatabase(products, new Map([
    ["approved-vendor", approvedVendor],
    ["pending-vendor", pendingVendor],
  ])));
  t.after(api.close);

  const byIds = await fetch(`${api.baseUrl}/api/public-products/by-ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["approved", "pending", "missing", "approved"] }),
  });
  assert.equal(byIds.status, 200);
  const byIdProducts = (await byIds.json()).products;
  assert.deepEqual(byIdProducts.map(({ id }) => id), ["approved"]);
  assert.equal(byIdProducts[0].vendorBusinessName, "Approved Parts");

  const approvedDetail = await fetch(`${api.baseUrl}/api/public-products/approved`);
  assert.equal(approvedDetail.status, 200);
  const approvedProduct = (await approvedDetail.json()).product;
  assert.equal(approvedProduct.id, "approved");
  assert.equal(approvedProduct.vendorBusinessName, "Approved Parts");

  const pendingDetail = await fetch(`${api.baseUrl}/api/public-products/pending`);
  assert.equal(pendingDetail.status, 404);
  const missingDetail = await fetch(`${api.baseUrl}/api/public-products/missing`);
  assert.equal(missingDetail.status, 404);
});

test("legacy seller IDs and vendor links require approved vendor accounts", async (t) => {
  const products = new Map([
    ["approved-seller-id", { ...publicFields, sellerId: "approved-vendor" }],
    ["pending-seller-id", { ...publicFields, sellerId: "pending-vendor" }],
    ["approved-link", publicFields],
    ["pending-link", publicFields],
  ]);
  const api = await startCatalogApi(makeDatabase(products, new Map([
    ["approved-vendor", approvedVendor],
    ["pending-vendor", pendingVendor],
  ]), new Map([
    ["approved-link", "approved-vendor"],
    ["pending-link", "pending-vendor"],
  ])));
  t.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/public-products`);
  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).products.map(({ id }) => id).sort(),
    ["approved-link", "approved-seller-id"],
  );
});

test("catalogue routes reject invalid IDs and cursors", async (t) => {
  const api = await startCatalogApi(makeDatabase(new Map(), new Map()));
  t.after(api.close);

  const invalidCursor = await fetch(`${api.baseUrl}/api/public-products?after=${encodeURIComponent("bad/id")}`);
  assert.equal(invalidCursor.status, 400);  const invalidLimit = await fetch(`${api.baseUrl}/api/public-products?limit=101`);
  assert.equal(invalidLimit.status, 400);
  const invalidCategory = await fetch(`${api.baseUrl}/api/public-products?category=${"x".repeat(121)}`);
  assert.equal(invalidCategory.status, 400);
  const invalidDetail = await fetch(`${api.baseUrl}/api/public-products/${encodeURIComponent("bad/id")}`);
  assert.equal(invalidDetail.status, 400);
  const invalidBody = await fetch(`${api.baseUrl}/api/public-products/by-ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["bad/id"] }),
  });
  assert.equal(invalidBody.status, 400);
});

test("catalogue routes preserve per-IP rate limiting", async (t) => {
  let requestIp = "catalog-test-a";
  const api = await startCatalogApi(makeDatabase(new Map(), new Map()), () => requestIp);
  t.after(api.close);

  for (let index = 0; index < 120; index += 1) {
    assert.equal((await fetch(`${api.baseUrl}/api/public-products`)).status, 200);
  }
  assert.equal((await fetch(`${api.baseUrl}/api/public-products`)).status, 429);
  requestIp = "catalog-test-b";
  assert.equal((await fetch(`${api.baseUrl}/api/public-products`)).status, 200);
});

test("catalogue eligibility fails closed for malformed price and conflicting publication fields", async (t) => {
  const products = new Map([
    ["eligible", publicFields],
    ["bad-price", { ...publicFields, price: "2,500" }],
    ["conflicting-status", { ...publicFields, approvalStatus: "pending" }],
    ["disabled-string", { ...publicFields, enabled: "false" }],
    ["malformed-status", { ...publicFields, publishStatus: true }],
    ["unsupported-seller", { ...publicFields, sellerType: "customer" }],
  ]);
  const api = await startCatalogApi(makeDatabase(products, new Map()));
  t.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/public-products`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).products.map(({ id }) => id), ["eligible"]);
});
