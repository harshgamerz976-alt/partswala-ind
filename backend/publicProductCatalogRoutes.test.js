import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { registerPublicProductCatalogRoutes } from "./publicProductCatalogRoutes.js";
import { publicProductCatalogIndexFields } from "./publicProductCatalogIndex.js";
import { normalizeProduct } from "../src/services/productCatalog.js";

function makeDocument(id, data) {
  return {
    id,
    exists: Boolean(data),
    data: () => data,
  };
}

function makeDatabase(products, vendors) {
  const indexedProducts = new Map([...products].map(([id, product]) => {
    const normalized = normalizeProduct({ id, ...product });
    const vendor = normalized.sellerType.toLowerCase() === "vendor"
      ? vendors.get(normalized.sellerId) || null
      : undefined;
    return [id, { ...product, ...publicProductCatalogIndexFields(id, product, vendor) }];
  }));
  const stats = { queryCount: 0, queriedProductReads: 0, directProductReads: 0, vendorReads: 0 };

  function productDocument(id) {
    return makeDocument(id, indexedProducts.get(id));
  }

  return {
    stats,
    collection(name) {
      if (name === "users") {
        return { doc: (id) => ({ collectionName: name, id }) };
      }
      return {
        orderBy() {
          let cursor = "";
          let limit = 100;
          const conditions = [];
          return {
            where(field, operator, value) {
              conditions.push({ field, operator, value });
              return this;
            },
            startAfter(value) {
              cursor = value;
              return this;
            },
            limit(value) {
              limit = value;
              return this;
            },
            async get() {
              stats.queryCount += 1;
              const docs = [...indexedProducts.keys()]
                .filter((id) => id > cursor
                  && conditions.every(({ field, operator, value }) => {
                    const product = indexedProducts.get(id);
                    if (operator === "array-contains") return product[field]?.includes(value);
                    return product[field] === value;
                  }))
                .sort()
                .slice(0, limit)
                .map(productDocument);
              stats.queriedProductReads += docs.length;
              return { docs, size: docs.length };
            },
          };
        },
        doc: (id) => ({
          collectionName: name,
          id,
          async get() {
            stats.directProductReads += 1;
            return productDocument(id);
          },
        }),
      };
    },
    async getAll(...references) {
      return references.map(({ collectionName, id }) => {
        if (collectionName === "users") {
          stats.vendorReads += 1;
          return makeDocument(id, vendors.get(id));
        }
        stats.directProductReads += 1;
        return productDocument(id);
      });
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
  email: "private@example.test",
  phone: "private phone",
  vendorProfile: {
    businessName: "Approved Synthetic Supplier",
    ownerName: "Private owner",
    email: "private@example.test",
    phone: "private phone",
    businessAddress: "private address",
    gstin: "private GSTIN",
  },
};
const pendingVendor = { role: "vendor", vendorStatus: "pending" };
const publicFields = {
  name: "Synthetic public part",
  price: 2500,
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
      email: "private@example.test",
      phone: "private phone",
      ownerName: "Private owner",
      businessAddress: "private address",
      gstin: "private GSTIN",
      vendorProfile: approvedVendor.vendorProfile,
      catalogSearchNgrams: ["private-internal-index"],
      catalogVendorBusinessName: "Internal supplier name",
    }],
    ["approved-legacy", {
      ...publicFields,
      vendorType: "vendor",
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
    ["pending-product", { ...publicFields, status: "pending" }],
  ]);
  const database = makeDatabase(products, new Map([
    ["approved-vendor", approvedVendor],
    ["pending-vendor", pendingVendor],
  ]));
  const api = await startCatalogApi(database);
  t.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/public-products`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.products.map(({ id }) => id), ["approved", "approved-legacy"]);
  assert.deepEqual(
    Object.keys(result).sort(),
    ["hasMore", "nextCursor", "products", "scanCursor"].sort(),
  );
  assert.equal(result.scanCursor, "pending-vendor");
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
  for (const field of [
    "vendorAddress",
    "vendorGstin",
    "vendorState",
    "email",
    "phone",
    "ownerName",
    "businessAddress",
    "gstin",
    "vendorProfile",
    "catalogSearchNgrams",
    "catalogVendorBusinessName",
  ]) {
    assert.equal(field in result.products[0], false);
  }
  assert.deepEqual(
    Object.keys(result.products[0]).sort(),
    ["id", "name", "price", "enabled", "status", "sellerType", "sellerId", "vendorBusinessName", "imageUrl"].sort(),
  );
  assert.equal(result.products[0].vendorBusinessName, "Approved Synthetic Supplier");
  assert.equal("description" in result.products[0], false);
  assert.equal("images" in result.products[0], false);
  assert.equal("catalogSearchNgrams" in result.products[0], false);
  assert.equal(database.stats.directProductReads, 0);
  assert.equal(database.stats.queriedProductReads, 4);
  assert.equal(database.stats.vendorReads, 2);
});

test("catalogue search matches an approved profile name absent from the product document", async (t) => {
  const products = new Map([
    ["profile-name-only", {
      ...publicFields,
      sellerType: "vendor",
      sellerId: "approved-vendor",
    }],
  ]);
  const api = await startCatalogApi(makeDatabase(products, new Map([
    ["approved-vendor", approvedVendor],
  ])));
  t.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/public-products?search=${encodeURIComponent("synthetic supplier")}`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.products.map(({ id }) => id), ["profile-name-only"]);
  assert.equal(result.products[0].vendorBusinessName, "Approved Synthetic Supplier");
  for (const privateField of ["email", "phone", "ownerName", "businessAddress", "gstin", "catalogVendorBusinessName"]) {
    assert.equal(privateField in result.products[0], false);
  }
});

test("by-IDs and detail routes return only approved public products", async (t) => {
  const products = new Map([
    ["approved", {
      ...publicFields,
      sellerType: "vendor",
      sellerId: "approved-vendor",
      vendorAddress: "private address",
      vendorGstin: "private GSTIN",
      email: "private@example.test",
      vendorProfile: approvedVendor.vendorProfile,
      catalogSearchNgrams: ["private-internal-index"],
      catalogVendorBusinessName: "Internal supplier name",
    }],
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
  const byIdsResult = await byIds.json();
  assert.deepEqual(byIdsResult.products.map(({ id }) => id), ["approved"]);

  const approvedDetail = await fetch(`${api.baseUrl}/api/public-products/approved`);
  assert.equal(approvedDetail.status, 200);
  const approvedDetailResult = await approvedDetail.json();
  assert.equal(approvedDetailResult.product.id, "approved");
  for (const product of [byIdsResult.products[0], approvedDetailResult.product]) {
    for (const field of [
      "vendorAddress",
      "vendorGstin",
      "email",
      "vendorProfile",
      "catalogSearchNgrams",
      "catalogVendorBusinessName",
    ]) {
      assert.equal(field in product, false);
    }
  }

  const pendingDetail = await fetch(`${api.baseUrl}/api/public-products/pending`);
  assert.equal(pendingDetail.status, 404);
  const missingDetail = await fetch(`${api.baseUrl}/api/public-products/missing`);
  assert.equal(missingDetail.status, 404);
});

test("catalogue routes reject invalid IDs and cursors", async (t) => {
  const api = await startCatalogApi(makeDatabase(new Map(), new Map()));
  t.after(api.close);

  const invalidCursor = await fetch(`${api.baseUrl}/api/public-products?after=${encodeURIComponent("bad/id")}`);
  assert.equal(invalidCursor.status, 400);
  const malformedOpaqueCursor = await fetch(`${api.baseUrl}/api/public-products?cursor=not-a-cursor`);
  assert.equal(malformedOpaqueCursor.status, 400);
  const invalidPageSize = await fetch(`${api.baseUrl}/api/public-products?limit=101`);
  assert.equal(invalidPageSize.status, 400);
  const invalidDetail = await fetch(`${api.baseUrl}/api/public-products/${encodeURIComponent("bad/id")}`);
  assert.equal(invalidDetail.status, 400);
  const invalidBody = await fetch(`${api.baseUrl}/api/public-products/by-ids`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["bad/id"] }),
  });
  assert.equal(invalidBody.status, 400);
});

test("indexed catalogue cursor pages neither skip nor duplicate eligible products", async (t) => {
  const products = new Map(Array.from({ length: 5 }, (_, index) => [
    `product-${String(index + 1).padStart(2, "0")}`,
    { ...publicFields, name: `Truck part ${index + 1}` },
  ]));
  const database = makeDatabase(products, new Map());
  const api = await startCatalogApi(database);
  t.after(api.close);

  const firstResponse = await fetch(`${api.baseUrl}/api/public-products?limit=2`);
  const first = await firstResponse.json();
  assert.deepEqual(first.products.map(({ id }) => id), ["product-01", "product-02"]);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);

  const secondResponse = await fetch(`${api.baseUrl}/api/public-products?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`);
  const second = await secondResponse.json();
  assert.deepEqual(second.products.map(({ id }) => id), ["product-03", "product-04"]);
  assert.equal(second.hasMore, true);

  const thirdResponse = await fetch(`${api.baseUrl}/api/public-products?limit=2&cursor=${encodeURIComponent(second.nextCursor)}`);
  const third = await thirdResponse.json();
  assert.deepEqual(third.products.map(({ id }) => id), ["product-05"]);
  assert.equal(third.hasMore, false);
  assert.equal(third.nextCursor, null);
  assert.equal(new Set([...first.products, ...second.products, ...third.products].map(({ id }) => id)).size, 5);
  assert.equal(database.stats.directProductReads, 0);
});

test("legacy after cursors continue from scanCursor without skipping or duplicating products", async (t) => {
  const products = new Map(Array.from({ length: 5 }, (_, index) => [
    `product-${String(index + 1).padStart(2, "0")}`,
    { ...publicFields, name: `Truck part ${index + 1}` },
  ]));
  const api = await startCatalogApi(makeDatabase(products, new Map()));
  t.after(api.close);

  const firstResponse = await fetch(`${api.baseUrl}/api/public-products?limit=2`);
  const first = await firstResponse.json();
  const secondResponse = await fetch(
    `${api.baseUrl}/api/public-products?limit=2&after=${encodeURIComponent(first.scanCursor)}`,
  );
  const second = await secondResponse.json();

  assert.deepEqual(first.products.map(({ id }) => id), ["product-01", "product-02"]);
  assert.deepEqual(second.products.map(({ id }) => id), ["product-03", "product-04"]);
  assert.equal(first.hasMore, true);
  assert.ok(first.nextCursor);
  assert.equal(second.hasMore, true);
  assert.ok(second.nextCursor);
  assert.equal(new Set([...first.products, ...second.products].map(({ id }) => id)).size, 4);
});

test("catalogue filters cover substring search, category, compatibility, availability, and empty results", async (t) => {
  const products = new Map([
    ["brake-front", {
      ...publicFields,
      name: "Front braking component",
      description: "Heavy duty Tata fitment",
      category: "Brakes",
      compatibility: "Tata 1612 front axle",
      stock: 5,
    }],
    ["brake-out", {
      ...publicFields,
      name: "Rear brake part",
      category: "Brakes",
      compatibility: "Tata 1612 rear axle",
      stock: 0,
    }],
    ["clutch", {
      ...publicFields,
      name: "Tata clutch part",
      category: "Clutch",
      compatibility: "Tata 1612",
      stock: 4,
    }],
  ]);
  const database = makeDatabase(products, new Map());
  const api = await startCatalogApi(database);
  t.after(api.close);

  const filteredResponse = await fetch(`${api.baseUrl}/api/public-products?search=uty%20tata&category=Brakes&compatibility=front&stockStatus=in-stock`);
  assert.equal(filteredResponse.status, 200);
  assert.deepEqual((await filteredResponse.json()).products.map(({ id }) => id), ["brake-front"]);
  assert.equal(database.stats.queriedProductReads, 1);

  const emptyResponse = await fetch(`${api.baseUrl}/api/public-products?search=not-present`);
  assert.equal(emptyResponse.status, 200);
  const empty = await emptyResponse.json();
  assert.deepEqual(empty.products, []);
  assert.equal(empty.hasMore, false);
  assert.equal(empty.nextCursor, null);
});

test("availability pagination reads only matching indexed candidates", async (t) => {
  const products = new Map([
    ["available", { ...publicFields, stock: 3 }],
    ["unavailable", { ...publicFields, stock: 0 }],
    ["unknown", { ...publicFields }],
  ]);
  const database = makeDatabase(products, new Map());
  const api = await startCatalogApi(database);
  t.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/public-products?stockStatus=in-stock`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).products.map(({ id }) => id), ["available"]);
  assert.equal(database.stats.queriedProductReads, 1);
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
  ]);
  const api = await startCatalogApi(makeDatabase(products, new Map()));
  t.after(api.close);

  const response = await fetch(`${api.baseUrl}/api/public-products`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).products.map(({ id }) => id), ["eligible"]);
});
