import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { once } from "node:events";
import { registerVendorApplicationDecisionRoute } from "./vendorApplicationDecisionRoute.js";
import { refreshVendorProductSearchIndex } from "./vendorProductSearchIndex.js";
import { searchCandidateNgram } from "./publicProductCatalogIndex.js";

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function makeDatabase({
  application = { status: "pending", businessName: "Current Supplier" },
  vendor = null,
  products = [],
  failAfterApplyOnCommits = [],
} = {}) {
  const documents = {
    vendorApplications: new Map([["vendor-1", clone(application)]]),
    users: new Map(vendor ? [["vendor-1", clone(vendor)]] : []),
    products: new Map(products.map((product) => [product.id, clone(product)])),
  };
  const failures = new Set(failAfterApplyOnCommits);
  const stats = { commits: 0, applicationUpdates: 0, userSets: 0 };

  function reference(collectionName, id) {
    return { collectionName, id };
  }
  function snapshot(ref) {
    const data = documents[ref.collectionName]?.get(ref.id);
    return { id: ref.id, ref, exists: data !== undefined, data: () => clone(data) };
  }
  function applyTransactionWrite({ type, ref, data, options }) {
    const collection = documents[ref.collectionName];
    if (type === "update") collection.set(ref.id, { ...collection.get(ref.id), ...clone(data) });
    if (type === "set") {
      const current = collection.get(ref.id);
      collection.set(ref.id, options?.merge && current ? { ...current, ...clone(data) } : clone(data));
    }
    if (ref.collectionName === "vendorApplications" && type === "update") stats.applicationUpdates += 1;
    if (ref.collectionName === "users" && type === "set") stats.userSets += 1;
  }

  const database = {
    documents,
    stats,
    collection(name) {
      return {
        doc(id) {
          return reference(name, id);
        },
        where(field, _operator, value) {
          return {
            async get() {
              const rows = documents[name];
              const docs = [...rows.entries()]
                .filter(([, row]) => field.split(".").reduce((current, key) => current?.[key], row) === value)
                .map(([id]) => snapshot(reference(name, id)));
              return { docs };
            },
          };
        },
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        get: async (ref) => snapshot(ref),
        update: (ref, data) => writes.push({ type: "update", ref, data }),
        set: (ref, data, options) => writes.push({ type: "set", ref, data, options }),
      });
      for (const write of writes) applyTransactionWrite(write);
      return result;
    },
    batch() {
      const writes = [];
      return {
        update(ref, data) {
          writes.push({ ref, data });
        },
        async commit() {
          stats.commits += 1;
          for (const { ref, data } of writes) {
            documents.products.set(ref.id, { ...documents.products.get(ref.id), ...clone(data) });
          }
          if (failures.delete(stats.commits)) {
            const error = new Error("Transient Firestore commit failure");
            error.code = "unavailable";
            throw error;
          }
        },
      };
    },
  };
  return database;
}

async function startDecisionApi(database, t) {
  const app = express();
  app.use(express.json());
  registerVendorApplicationDecisionRoute(app, {
    getDb: () => database,
    authenticatedUser: async () => ({ uid: "admin-1" }),
    isAdminUser: () => true,
    stageAdminAudit: () => {},
    refreshVendorProductSearchIndex,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function decide(baseUrl, status, reason = "") {
  return fetch(`${baseUrl}/api/admin/vendor-applications/vendor-1`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reason }),
  });
}

function product(id, overrides = {}) {
  return {
    id,
    sellerId: "vendor-1",
    sellerType: "vendor",
    name: `Part ${id}`,
    price: 250,
    enabled: true,
    status: "Available",
    catalogVendorBusinessName: "Old Supplier",
    ...overrides,
  };
}

test("matching completed decision retries refresh without rewriting application or vendor status", async (t) => {
  const database = makeDatabase({
    application: { status: "approved", businessName: "Current Supplier" },
    vendor: { role: "vendor", vendorStatus: "approved", vendorProfile: { businessName: "Current Supplier" } },
    products: [product("part-1")],
    failAfterApplyOnCommits: [1],
  });
  const baseUrl = await startDecisionApi(database, t);

  const response = await decide(baseUrl, "approved");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, status: "approved" });
  assert.equal(database.stats.applicationUpdates, 0);
  assert.equal(database.stats.userSets, 0);
  assert.equal(database.stats.commits, 2);
  assert.equal(database.documents.products.get("part-1").catalogVendorBusinessName, "Current Supplier");
});

test("conflicting decision for a completed application returns HTTP 409 without writes", async (t) => {
  const database = makeDatabase({
    application: { status: "approved", businessName: "Current Supplier" },
    vendor: { role: "vendor", vendorStatus: "approved" },
    products: [product("part-1")],
  });
  const baseUrl = await startDecisionApi(database, t);

  const response = await decide(baseUrl, "rejected", "Conflicting decision");

  assert.equal(response.status, 409);
  assert.equal((await response.json()).message, "APPLICATION_NOT_PENDING");
  assert.equal(database.stats.applicationUpdates, 0);
  assert.equal(database.stats.userSets, 0);
  assert.equal(database.stats.commits, 0);
});

test("partial refresh exhaustion can be retried over HTTP without rewriting the completed decision", async (t) => {
  const database = makeDatabase({
    application: { status: "pending", businessName: "Current Supplier" },
    products: [product("part-1"), product("part-2")],
    failAfterApplyOnCommits: [1, 2, 3],
  });
  const baseUrl = await startDecisionApi(database, t);

  const firstResponse = await decide(baseUrl, "approved");
  assert.equal(firstResponse.status, 500);
  assert.match((await firstResponse.json()).message, /failed after 3 attempts/);
  assert.equal(database.documents.vendorApplications.get("vendor-1").status, "approved");
  assert.equal(database.documents.users.get("vendor-1").vendorStatus, "approved");
  assert.equal(database.stats.applicationUpdates, 1);
  assert.equal(database.stats.userSets, 1);

  const retryResponse = await decide(baseUrl, "approved");
  assert.equal(retryResponse.status, 200);
  assert.equal(database.stats.applicationUpdates, 1);
  assert.equal(database.stats.userSets, 1);
  for (const indexedProduct of database.documents.products.values()) {
    assert.equal(indexedProduct.catalogVendorBusinessName, "Current Supplier");
    assert.ok(indexedProduct.catalogSearchNgrams.includes(searchCandidateNgram("current")));
  }
});

test("HTTP response clearly reports exhausted refresh retries", async (t) => {
  const database = makeDatabase({
    application: { status: "pending", businessName: "Current Supplier" },
    products: [product("part-1")],
    failAfterApplyOnCommits: [1, 2, 3],
  });
  const baseUrl = await startDecisionApi(database, t);

  const response = await decide(baseUrl, "approved");

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    message: "Vendor product search-index refresh failed after 3 attempts.",
  });
});
