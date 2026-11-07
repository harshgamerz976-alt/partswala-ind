import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { registerPublicProductCatalogRoutes, setPublicProductCatalogNoStore } from "./publicProductCatalogRoutes.js";

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

async function startCatalogApi(
  database,
  resolveClientIp = () => "catalog-test",
  now = () => Date.parse("2026-11-08T00:00:00+05:30"),
) {
  const app = express();
  app.use(setPublicProductCatalogNoStore);
  app.use(express.json());
  registerPublicProductCatalogRoutes(app, {
    getDb: () => database,
    resolveClientIp,
    now,
  });
  app.use((error, _request, response, _next) => {
    response.status(error.status || 500).end();
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

test("catalogue list, detail, and by-ID routes open exactly at the launch instant", async (t) => {
  const launchTime = Date.parse("2026-11-07T18:30:00.000Z");
  let now = launchTime - 1;
  let databaseReads = 0;
  const database = makeDatabase(new Map([
    ["launch-gated-product", { ...publicFields }],
  ]), new Map());
  const trackedDatabase = {
    collection(...args) {
      databaseReads += 1;
      return database.collection(...args);
    },
    getAll(...args) {
      databaseReads += 1;
      return database.getAll(...args);
    },
  };
  const api = await startCatalogApi(trackedDatabase, undefined, () => now);
  t.after(api.close);

  const requests = [
    () => fetch(`${api.baseUrl}/api/public-products?limit=1`),
    () => fetch(`${api.baseUrl}/api/public-products?category=Engine&limit=1&after=cursor`),
    () => fetch(`${api.baseUrl}/api/public-products/launch-gated-product`),
    () => fetch(`${api.baseUrl}/api/public-products/by-ids`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productIds: ["launch-gated-product"] }),
    }),
  ];

  for (const request of requests) {
    const response = await request();
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { message: "The PartsWalaIND marketplace is not open yet." });
  }
  assert.equal(databaseReads, 0, "pre-launch routes must reject before any product or vendor reads");

  now = launchTime;
  for (const [request, expectedStatus] of [
    [requests[0], 200],
    [requests[1], 400],
    [requests[2], 200],
    [requests[3], 200],
  ]) {
    const response = await request();
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    if (request === requests[0]) {
      assert.deepEqual(body.products.map(({ id }) => id), ["launch-gated-product"]);
    } else if (request === requests[2]) {
      assert.equal(body.product.id, "launch-gated-product");
    } else if (request === requests[3]) {
      assert.deepEqual(body.products.map(({ id }) => id), ["launch-gated-product"]);
    }
  }

  now = launchTime + 1;
  for (const [request, expectedStatus] of [
    [requests[0], 200],
    [requests[1], 400],
    [requests[2], 200],
    [requests[3], 200],
  ]) {
    const response = await request();
    assert.equal(response.status, expectedStatus);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    if (request === requests[0]) {
      assert.deepEqual(body.products.map(({ id }) => id), ["launch-gated-product"]);
    } else if (request === requests[2]) {
      assert.equal(body.product.id, "launch-gated-product");
    } else if (request === requests[3]) {
      assert.deepEqual(body.products.map(({ id }) => id), ["launch-gated-product"]);
    }
  }
});

test("catalogue path case variants retain no-store headers and the pre-launch gate", async (t) => {
  const api = await startCatalogApi(makeDatabase(new Map(), new Map()), undefined, () => Date.parse("2026-11-07T18:29:59.999Z"));
  t.after(api.close);

  for (const path of [
    "/API/public-products?limit=1",
    "/api/Public-products?limit=1",
    "/api/public-products/?limit=1",
  ]) {
    const response = await fetch(`${api.baseUrl}${path}`);
    assert.equal(response.status, 403, `${path} must retain the pre-launch gate`);
    assert.equal(response.headers.get("cache-control"), "no-store", `${path} must not be cached`);
  }
});

test("catalogue routes fail closed for missing or invalid server time before reading data", async () => {
  const unavailableDatabase = {
    collection() {
      assert.fail("A request with an invalid launch clock must not read product or vendor data.");
    },
    getAll() {
      assert.fail("A request with an invalid launch clock must not read product or vendor data.");
    },
  };

  for (const now of [() => Number.NaN, () => undefined, () => Number.POSITIVE_INFINITY]) {
    const api = await startCatalogApi(unavailableDatabase, undefined, now);
    try {
      for (const path of [
        "/api/public-products?limit=1",
        "/api/public-products?category=Engine&after=cursor&limit=10",
        "/api/public-products/test-product",
      ]) {
        const response = await fetch(`${api.baseUrl}${path}`);
        assert.equal(response.status, 403);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await response.json(), { message: "The PartsWalaIND marketplace is not open yet." });
      }

      const byIds = await fetch(`${api.baseUrl}/api/public-products/by-ids`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productIds: ["test-product"] }),
      });
      assert.equal(byIds.status, 403);
      assert.equal(byIds.headers.get("cache-control"), "no-store");
      assert.deepEqual(await byIds.json(), { message: "The PartsWalaIND marketplace is not open yet." });
    } finally {
      await api.close();
    }
  }
});

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

test("public product normalization preserves approved vendor eligibility across seller-type casing", async (t) => {
  const products = new Map([
    ["case-variant", { ...publicFields, sellerType: " Vendor ", sellerId: "approved-vendor" }],
  ]);
  const api = await startCatalogApi(makeDatabase(products, new Map([
    ["approved-vendor", approvedVendor],
  ])));
  t.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/public-products`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.products[0].id, "case-variant");
  assert.equal(result.products[0].vendorBusinessName, "Approved Parts");
});

test("catalogue routes reject invalid IDs and cursors", async (t) => {
  const api = await startCatalogApi(makeDatabase(new Map(), new Map()));
  t.after(api.close);

  const invalidCursor = await fetch(`${api.baseUrl}/api/public-products?after=${encodeURIComponent("bad/id")}`);
  assert.equal(invalidCursor.status, 400);  const invalidLimit = await fetch(`${api.baseUrl}/api/public-products?limit=101`);
  assert.equal(invalidCursor.headers.get("cache-control"), "no-store");
  assert.equal(invalidLimit.status, 400);
  assert.equal(invalidLimit.headers.get("cache-control"), "no-store");
  const invalidCategory = await fetch(`${api.baseUrl}/api/public-products?category=${"x".repeat(121)}`);
  assert.equal(invalidCategory.status, 400);
  assert.equal(invalidCategory.headers.get("cache-control"), "no-store");
  const invalidDetail = await fetch(`${api.baseUrl}/api/public-products/${encodeURIComponent("bad/id")}`);
  assert.equal(invalidDetail.status, 400);
  assert.equal(invalidDetail.headers.get("cache-control"), "no-store");
  const invalidBody = await fetch(`${api.baseUrl}/api/public-products/by-ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["bad/id"] }),
  });
  assert.equal(invalidBody.status, 400);
  assert.equal(invalidBody.headers.get("cache-control"), "no-store");
});

test("malformed catalogue JSON errors are not cacheable", async (t) => {
  const api = await startCatalogApi(makeDatabase(new Map(), new Map()));
  t.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/public-products/by-ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{invalid-json",
  });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("catalogue routes preserve per-IP rate limiting", async (t) => {
  let requestIp = "catalog-test-a";
  const api = await startCatalogApi(makeDatabase(new Map(), new Map()), () => requestIp);
  t.after(api.close);

  for (let index = 0; index < 120; index += 1) {
    const response = await fetch(`${api.baseUrl}/api/public-products`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const limited = await fetch(`${api.baseUrl}/api/public-products`);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  requestIp = "catalog-test-b";
  const otherIp = await fetch(`${api.baseUrl}/api/public-products`);
  assert.equal(otherIp.status, 200);
  assert.equal(otherIp.headers.get("cache-control"), "no-store");
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
