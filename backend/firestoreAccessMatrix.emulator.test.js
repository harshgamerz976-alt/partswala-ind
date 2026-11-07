import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
const isLoopbackHost = (value) => /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value);
const emulatorConfigured = projectId.startsWith("demo-")
  && isLoopbackHost(firestoreHost)
  && isLoopbackHost(authHost);
const password = "LocalEmulatorPass123!";
const baseDocumentPath = `/v1/projects/${projectId}/databases/(default)/documents`;

function encodeValue(value) {
  if (value === null) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  return {
    mapValue: {
      fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeValue(item)])),
    },
  };
}

function encodeDocument(fields) {
  return { fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, encodeValue(value)])) };
}

async function emulatorRequest(host, path, options = {}) {
  const response = await fetch(`http://${host}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function signIn(email) {
  const { response, body } = await emulatorRequest(
    authHost,
    "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  assert.equal(response.ok, true, "Emulator account sign-in must succeed.");
  return body;
}

test("Firestore rules enforce a role and ownership access matrix for all sensitive collections", {
  skip: !emulatorConfigured && "Run with isolated demo-project Firebase Auth and Firestore emulators.",
}, async (t) => {
  assert.ok(projectId.startsWith("demo-"), "Rules tests must use a demo project.");
  assert.ok(isLoopbackHost(firestoreHost) && isLoopbackHost(authHost), "Rules tests must use local emulators.");

  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
  const suffix = randomUUID();
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { cert, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = initializeApp({
    credential: cert({
      projectId,
      clientEmail: `rules-matrix-${suffix}@example.test`,
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    }),
    projectId,
  }, `rules-matrix-${suffix}`);
  const auth = getAuth(app);
  const database = getFirestore(app);
  const accounts = [];
  const seededPaths = new Set();
  const actors = {};

  async function createActor(role, { vendorStatus, admin = false, phoneNumber } = {}) {
    const email = `${role}-${randomUUID()}@example.test`;
    const user = await auth.createUser({
      email,
      password,
      ...(phoneNumber ? { phoneNumber } : {}),
    });
    accounts.push(user.uid);
    if (admin) await auth.setCustomUserClaims(user.uid, { admin: true });
    if (role !== "new-customer") {
      await database.collection("users").doc(user.uid).set({
        role,
        ...(role === "vendor" ? { vendorStatus } : {}),
      });
      seededPaths.add(`users/${user.uid}`);
    }
    return { uid: user.uid, email, ...(await signIn(email)) };
  }

  function authHeaders(token) {
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  async function readDocument(path, token) {
    return (await emulatorRequest(firestoreHost, `${baseDocumentPath}/${path}`, {
      headers: authHeaders(token),
    })).response.status;
  }

  async function queryCollection(path, field, value, token) {
    const collectionPath = path.split("/");
    const structuredQuery = {
      from: [{ collectionId: collectionPath.at(-1) }],
      where: {
        fieldFilter: {
          field: { fieldPath: field },
          op: "EQUAL",
          value: encodeValue(value),
        },
      },
      limit: 10,
    };
    const parentPath = collectionPath.slice(0, -1).join("/");
    const { response } = await emulatorRequest(
      firestoreHost,
      `${baseDocumentPath}${parentPath ? `/${parentPath}` : ""}:runQuery`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ structuredQuery }),
      },
    );
    return response.status;
  }

  async function collectionList(path, token) {
    const { response, body } = await emulatorRequest(
      firestoreHost,
      `${baseDocumentPath}/${path}?pageSize=20`,
      { headers: authHeaders(token) },
    );
    return { status: response.status, documents: body.documents || [] };
  }

  async function collectionQuery(path, field, value, token) {
    const collectionPath = path.split("/");
    const structuredQuery = {
      from: [{ collectionId: collectionPath.at(-1) }],
      ...(field ? {
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: "EQUAL",
            value: encodeValue(value),
          },
        },
      } : {}),
      limit: 20,
    };
    const parentPath = collectionPath.slice(0, -1).join("/");
    const { response, body } = await emulatorRequest(
      firestoreHost,
      `${baseDocumentPath}${parentPath ? `/${parentPath}` : ""}:runQuery`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({ structuredQuery }),
      },
    );
    return {
      status: response.status,
      documents: Array.isArray(body)
        ? body.flatMap((entry) => entry.document ? [entry.document] : [])
        : [],
    };
  }

  async function createDocument(path, id, fields, token) {
    const query = new URLSearchParams({ documentId: id });
    const endpoint = `${baseDocumentPath}/${path}?${query}`;
    const { response } = await emulatorRequest(firestoreHost, endpoint, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(encodeDocument(fields)),
    });
    if (response.ok && !token) seededPaths.add(`${path}/${id}`);
    return response.status;
  }

  async function updateDocument(path, fields, token) {
    const query = new URLSearchParams();
    for (const field of Object.keys(fields)) query.append("updateMask.fieldPaths", field);
    const { response } = await emulatorRequest(firestoreHost, `${baseDocumentPath}/${path}?${query}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify(encodeDocument(fields)),
    });
    return response.status;
  }

  async function deleteDocument(path, token) {
    const { response } = await emulatorRequest(firestoreHost, `${baseDocumentPath}/${path}`, {
      method: "DELETE",
      headers: authHeaders(token),
    });
    return response.status;
  }

  async function serverTimestampWrite(path, token, fields) {
    const name = `projects/${projectId}/databases/(default)/documents/${path}`;
    const updateTransforms = Object.keys(fields).map((fieldPath) => ({
      fieldPath,
      setToServerValue: "REQUEST_TIME",
    }));
    const { response } = await emulatorRequest(
      firestoreHost,
      `/v1/projects/${projectId}/databases/(default)/documents:commit`,
      {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify({
          writes: [{
            update: { name, fields: {} },
            updateTransforms,
          }],
        }),
      },
    );
    return response.status;
  }

  function validApplication(actor) {
    return {
      vendorId: actor.uid,
      email: actor.email,
      phone: "+919999000001",
      businessName: "Emulator business",
      ownerName: "Emulator owner",
      businessAddress: "Emulator address",
      city: "Pune",
      state: "Maharashtra",
      pincode: "411001",
      gstin: "",
      pan: "",
      status: "pending",
      submittedAt: "emulator-test",
      reviewedAt: null,
      reviewedBy: "",
      rejectionReason: "",
    };
  }

  function validSubmission(actor, overrides = {}) {
    return {
      sellerId: actor.uid,
      name: "Emulator product",
      description: "Test-only submission",
      category: "Test",
      brand: "Test",
      partNumber: "TEST-1",
      mrp: 100,
      price: 90,
      stock: 1,
      hsn: "",
      gstRate: 18,
      compatibility: [],
      weight: 1,
      dimensions: {},
      images: ["https://example.test/test.jpg"],
      imageUrl: "https://example.test/test.jpg",
      vendorName: "Emulator vendor",
      submittedAt: "emulator-test",
      status: "pending",
      rejectionReason: "",
      ...overrides,
    };
  }

  try {
    actors.customer = await createActor("customer");
    actors.otherCustomer = await createActor("customer");
    actors.newCustomer = await createActor("new-customer");
    actors.vendor = await createActor("vendor", { vendorStatus: "approved" });
    actors.otherVendor = await createActor("vendor", { vendorStatus: "approved" });
    actors.pendingVendor = await createActor("vendor", { vendorStatus: "pending" });
    actors.admin = await createActor("admin", { admin: true, phoneNumber: "+919999000002" });
    actors.phoneCustomer = await createActor("customer", { phoneNumber: "+919999000001" });

    const ids = Object.fromEntries([
      "product", "otherProduct", "unownedProduct",
      "order", "vendorOrder", "productCost", "orderFinance", "vendorSettlement",
      "otherSettlement", "returnRequest", "auditLog", "category", "setting", "storeSetting",
      "coupon", "campaign", "counter", "usage", "notification", "token", "tokenOwner",
      "application", "otherApplication", "submission", "rejectedSubmission", "otherSubmission",
      "vendorLink", "presence", "phoneEvent", "legalAcceptance", "review", "unknown",
    ].map((key) => [key, `${key}-${suffix}`]));
    ids.storeSetting = "store";

    const fixtures = [
      ["products", ids.product, { sellerId: actors.vendor.uid, name: "Matrix own product" }],
      ["products", ids.otherProduct, { sellerId: actors.otherVendor.uid, name: "Matrix other product" }],
      ["products", ids.unownedProduct, { name: "Matrix unowned product" }],
      ["orders", ids.order, { userId: actors.customer.uid, status: "created" }],
      ["orders", ids.vendorOrder, { userId: actors.vendor.uid, status: "created" }],
      ["productCosts", ids.productCost, { cost: 50 }],
      ["orderFinance", ids.orderFinance, { total: 90 }],
      ["vendorSettlements", ids.vendorSettlement, { vendorId: actors.vendor.uid, amount: 90 }],
      ["vendorSettlements", ids.otherSettlement, { vendorId: actors.otherVendor.uid, amount: 80 }],
      ["returnRequests", ids.returnRequest, { userId: actors.customer.uid, status: "requested" }],
      ["adminAuditLogs", ids.auditLog, { actorId: actors.admin.uid, action: "test" }],
      ["categories", ids.category, { name: "Emulator category" }],
      ["settings", ids.setting, { value: "private" }],
      ["settings", ids.storeSetting, { value: "protected" }],
      ["coupons", ids.coupon, { code: "TEST" }],
      ["couponCampaigns", ids.campaign, { enabled: false }],
      ["couponCounters", ids.counter, { count: 0 }],
      ["couponUsage", ids.usage, { userId: actors.customer.uid }],
      [`users/${actors.customer.uid}/notifications`, ids.notification, { title: "Test notice" }],
      [`users/${actors.customer.uid}/fcmTokens`, ids.token, { token: "synthetic-token" }],
      ["fcmTokenOwners", ids.tokenOwner, { userId: actors.customer.uid }],
      ["vendorApplications", ids.otherApplication, { vendorId: actors.otherVendor.uid, status: "pending" }],
      ["sellerSubmissions", ids.submission, validSubmission(actors.vendor)],
      ["sellerSubmissions", ids.rejectedSubmission, validSubmission(actors.vendor, { status: "rejected", rejectionReason: "Fix image" })],
      ["sellerSubmissions", ids.otherSubmission, validSubmission(actors.otherVendor)],
      ["vendorProductLinks", ids.vendorLink, { vendorId: actors.vendor.uid, productId: "test-product" }],
      ["presence", actors.customer.uid, { lastSeen: new Date(), updatedAt: new Date() }],
      ["phoneVerificationEvents", ids.phoneEvent, { uid: actors.customer.uid }],
      ["legalAcceptances", ids.legalAcceptance, { uid: actors.customer.uid }],
      ["reviews", ids.review, { userId: actors.customer.uid, rating: 5 }],
      ["unlistedCollection", ids.unknown, { value: "denied" }],
    ];
    for (const [collection, id, data] of fixtures) {
      await database.collection(collection).doc(id).set(data);
      seededPaths.add(`${collection}/${id}`);
    }
    await database.collection("users").doc(actors.otherCustomer.uid).set({ displayName: "Other customer" });
    seededPaths.add(`users/${actors.otherCustomer.uid}`);
    await database.collection("sellerSubmissions").doc(ids.submission).update({ status: "pending" });

    await t.test("user profiles allow self access but protect role and server-owned fields", async () => {
      assert.equal(await readDocument(`users/${actors.customer.uid}`, undefined), 403);
      assert.equal(await readDocument(`users/${actors.customer.uid}`, actors.customer.idToken), 200);
      assert.equal(await readDocument(`users/${actors.otherCustomer.uid}`, actors.customer.idToken), 403);
      assert.equal(await readDocument(`users/${actors.otherCustomer.uid}`, actors.admin.idToken), 200);

      assert.equal(await createDocument("users", actors.newCustomer.uid, { role: "customer" }, actors.newCustomer.idToken), 200);
      seededPaths.add(`users/${actors.newCustomer.uid}`);
      assert.equal(await createDocument("users", actors.otherCustomer.uid, { role: "customer" }, actors.customer.idToken), 403);
      assert.equal(await createDocument("users", `forbidden-${suffix}`, { role: "vendor" }, actors.newCustomer.idToken), 403);
      assert.equal(await createDocument("users", `forbidden-admin-${suffix}`, { role: "customer", isAdmin: true }, actors.newCustomer.idToken), 403);
      assert.equal(await createDocument("users", `forbidden-verified-${suffix}`, {
        role: "customer",
        phoneVerified: true,
      }, actors.newCustomer.idToken), 403);

      assert.equal(await updateDocument(`users/${actors.customer.uid}`, { displayName: "Updated" }, actors.customer.idToken), 200);
      for (const protectedField of ["role", "vendorStatus", "vendorProfile", "isAdmin", "phoneVerified", "verifiedPhone", "phoneVerifiedAt", "phoneVerificationMethod"]) {
        assert.equal(await updateDocument(`users/${actors.customer.uid}`, { [protectedField]: "attacker-value" }, actors.customer.idToken), 403,
          `customers must not update ${protectedField}`);
      }
      assert.equal(await updateDocument(`users/${actors.customer.uid}`, { displayName: "Cross-user" }, actors.otherCustomer.idToken), 403);
      assert.equal(await deleteDocument(`users/${actors.customer.uid}`, actors.customer.idToken), 403);
      assert.equal(await updateDocument(`users/${actors.customer.uid}`, { role: "admin" }, actors.admin.idToken), 200);
      assert.equal(await deleteDocument(`users/${actors.newCustomer.uid}`, actors.admin.idToken), 200);
      seededPaths.delete(`users/${actors.newCustomer.uid}`);
    });

    await t.test("notification history is owner-readable while all notification and token writes are denied", async () => {
      const notificationPath = `users/${actors.customer.uid}/notifications/${ids.notification}`;
      assert.equal(await readDocument(notificationPath, undefined), 403);
      assert.equal(await readDocument(notificationPath, actors.customer.idToken), 200);
      for (const actor of [actors.otherCustomer, actors.vendor, actors.admin]) {
        assert.equal(await readDocument(notificationPath, actor.idToken), 403);
      }
      assert.equal(await queryCollection(`users/${actors.customer.uid}/notifications`, "title", "Test notice", actors.customer.idToken), 200);
      assert.equal(await queryCollection(`users/${actors.customer.uid}/notifications`, "title", "Test notice", actors.otherCustomer.idToken), 403);
      assert.equal(await updateDocument(notificationPath, { title: "Changed" }, actors.customer.idToken), 403);
      assert.equal(await deleteDocument(notificationPath, actors.customer.idToken), 403);
      assert.equal(await createDocument(`users/${actors.customer.uid}/notifications`, `new-${suffix}`, { title: "Client write" }, actors.customer.idToken), 403);

      for (const path of [
        `users/${actors.customer.uid}/fcmTokens/${ids.token}`,
        `fcmTokenOwners/${ids.tokenOwner}`,
      ]) {
        for (const actor of [undefined, actors.customer, actors.vendor, actors.admin]) {
          assert.equal(await readDocument(path, actor?.idToken), 403);
          assert.equal(await updateDocument(path, { token: "changed" }, actor?.idToken), 403);
          assert.equal(await deleteDocument(path, actor?.idToken), 403);
        }
      }
      assert.equal(await createDocument(`users/${actors.customer.uid}/fcmTokens`, `new-${suffix}`, { token: "client-token" }, actors.customer.idToken), 403);
      assert.equal(await createDocument("fcmTokenOwners", `new-${suffix}`, { userId: actors.customer.uid }, actors.admin.idToken), 403);
      assert.equal(await createDocument(`users/${actors.customer.uid}/fcmTokens`, `anonymous-${suffix}`, { token: "client-token" }), 403);
      assert.equal(await createDocument("fcmTokenOwners", `vendor-${suffix}`, { userId: actors.customer.uid }, actors.vendor.idToken), 403);
    });

    await t.test("collection list and queries enforce products, categories, settings, coupons, and campaigns access", async () => {
      const actorsForMatrix = [
        ["anonymous", undefined],
        ["customer", actors.customer],
        ["vendor", actors.vendor],
        ["pending vendor", actors.pendingVendor],
        ["admin", actors.admin],
      ];

      for (const [actorName, actor] of actorsForMatrix) {
        const productList = await collectionList("products", actor?.idToken);
        const productQuery = await collectionQuery("products", undefined, undefined, actor?.idToken);
        const expectedStatus = actorName === "admin" ? 200 : 403;
        assert.equal(productList.status, expectedStatus, `${actorName} list access to products`);
        assert.equal(productQuery.status, expectedStatus, `${actorName} unfiltered query access to products`);
        if (actorName === "admin") {
          assert.equal(productList.documents.length, 3);
          assert.equal(productQuery.documents.length, 3);
        }
      }

      const ownProductQuery = await collectionQuery("products", "sellerId", actors.vendor.uid, actors.vendor.idToken);
      assert.equal(ownProductQuery.status, 200);
      assert.deepEqual(ownProductQuery.documents.map(({ name }) => name), [
        `projects/${projectId}/databases/(default)/documents/products/${ids.product}`,
      ]);
      assert.equal((await collectionQuery("products", "sellerId", actors.otherVendor.uid, actors.vendor.idToken)).status, 403,
        "a vendor cannot query another vendor's products");
      assert.equal((await collectionQuery("products", undefined, undefined, actors.vendor.idToken)).status, 403,
        "an unfiltered vendor product query cannot prove ownership");
      assert.equal((await collectionQuery("products", "sellerId", actors.customer.uid, actors.customer.idToken)).status, 403,
        "customers cannot query products");
      assert.equal((await collectionQuery("products", "sellerId", actors.vendor.uid, actors.pendingVendor.idToken)).status, 403,
        "pending vendors cannot query private products");
      const adminProducts = await collectionQuery("products", undefined, undefined, actors.admin.idToken);
      assert.equal(adminProducts.status, 200);
      assert.equal(adminProducts.documents.length, 3);

      for (const [label, collection, expectedListStatus, expectedQueryStatus] of [
        ["categories", "categories", 200, 200],
        ["settings", "settings", 403, 403],
        ["coupons", "coupons", 403, 403],
        ["campaigns", "couponCampaigns", 403, 403],
      ]) {
        for (const [actorName, actor] of actorsForMatrix) {
          const listResult = await collectionList(collection, actor?.idToken);
          const queryResult = await collectionQuery(collection, undefined, undefined, actor?.idToken);
          const expected = actorName === "admin" ? 200 : expectedListStatus;
          assert.equal(listResult.status, expected, `${actorName} list access to ${label}`);
          assert.equal(queryResult.status, actorName === "admin" ? 200 : expectedQueryStatus,
            `${actorName} query access to ${label}`);
          if (actorName === "admin") {
            assert.ok(listResult.documents.length > 0, `admin list should return seeded ${label}`);
            assert.ok(queryResult.documents.length > 0, `admin query should return seeded ${label}`);
          }
        }
      }

      for (const [actorName, actor] of actorsForMatrix) {
        const categoryList = await collectionList("categories", actor?.idToken);
        const categoryQuery = await collectionQuery("categories", undefined, undefined, actor?.idToken);
        assert.ok(categoryList.documents.length > 0, `${actorName} can list public categories`);
        assert.ok(categoryQuery.documents.length > 0, `${actorName} can query public categories`);
      }

      const settingsQuery = await collectionQuery("settings", "value", "private", actors.customer.idToken);
      assert.equal(settingsQuery.status, 403, "filtering settings must not bypass admin-only reads");
      const couponQuery = await collectionQuery("coupons", "code", "TEST", actors.vendor.idToken);
      assert.equal(couponQuery.status, 403, "filtering coupons must not bypass admin-only reads");
      const campaignQuery = await collectionQuery("couponCampaigns", "enabled", false, actors.customer.idToken);
      assert.equal(campaignQuery.status, 403, "filtering campaigns must not bypass admin-only reads");

      const adminSettings = await collectionQuery("settings", "value", "private", actors.admin.idToken);
      const adminCoupons = await collectionQuery("coupons", "code", "TEST", actors.admin.idToken);
      const adminCampaigns = await collectionQuery("couponCampaigns", "enabled", false, actors.admin.idToken);
      assert.equal(adminSettings.status, 200);
      assert.equal(adminCoupons.status, 200);
      assert.equal(adminCampaigns.status, 200);
      assert.equal(adminSettings.documents.length, 1);
      assert.equal(adminCoupons.documents.length, 1);
      assert.equal(adminCampaigns.documents.length, 1);
    });

    await t.test("orders are owner/admin readable and immutable to every browser role", async () => {
      const orderPath = `orders/${ids.order}`;
      assert.equal(await readDocument(orderPath, undefined), 403);
      assert.equal(await readDocument(orderPath, actors.customer.idToken), 200);
      assert.equal(await readDocument(orderPath, actors.otherCustomer.idToken), 403);
      assert.equal(await readDocument(orderPath, actors.vendor.idToken), 403);
      assert.equal(await readDocument(`orders/${ids.vendorOrder}`, actors.vendor.idToken), 200);
      assert.equal(await readDocument(orderPath, actors.admin.idToken), 200);
      assert.equal(await queryCollection("orders", "userId", actors.customer.uid, actors.customer.idToken), 200);
      assert.equal(await queryCollection("orders", "userId", actors.vendor.uid, actors.customer.idToken), 403);

      for (const actor of [undefined, actors.customer, actors.otherCustomer, actors.vendor, actors.admin]) {
        assert.equal(await createDocument("orders", `new-${randomUUID()}`, { userId: actors.customer.uid }, actor?.idToken), 403);
        assert.equal(await updateDocument(orderPath, { status: "settled" }, actor?.idToken), 403);
        assert.equal(await deleteDocument(orderPath, actor?.idToken), 403);
      }
    });

    await t.test("finance and settlement reads are scoped and all client writes are denied", async () => {
      for (const collection of ["productCosts", "orderFinance"]) {
        const path = `${collection}/${ids[collection === "productCosts" ? "productCost" : "orderFinance"]}`;
        assert.equal(await readDocument(path, undefined), 403);
        assert.equal(await readDocument(path, actors.customer.idToken), 403);
        assert.equal(await readDocument(path, actors.vendor.idToken), 403);
        assert.equal(await readDocument(path, actors.admin.idToken), 200);
        for (const actor of [undefined, actors.customer, actors.vendor, actors.admin]) {
          assert.equal(await createDocument(collection, `new-${randomUUID()}`, { amount: 1 }, actor?.idToken), 403);
          assert.equal(await updateDocument(path, { amount: 2 }, actor?.idToken), 403);
          assert.equal(await deleteDocument(path, actor?.idToken), 403);
        }
      }

      const settlementPath = `vendorSettlements/${ids.vendorSettlement}`;
      assert.equal(await readDocument(settlementPath, undefined), 403);
      assert.equal(await readDocument(settlementPath, actors.customer.idToken), 403);
      assert.equal(await readDocument(settlementPath, actors.vendor.idToken), 200);
      assert.equal(await readDocument(settlementPath, actors.otherVendor.idToken), 403);
      assert.equal(await readDocument(settlementPath, actors.admin.idToken), 200);
      assert.equal(await queryCollection("vendorSettlements", "vendorId", actors.vendor.uid, actors.vendor.idToken), 200);
      assert.equal(await queryCollection("vendorSettlements", "vendorId", actors.otherVendor.uid, actors.vendor.idToken), 403);
      for (const actor of [undefined, actors.vendor, actors.admin]) {
        assert.equal(await createDocument("vendorSettlements", `new-${randomUUID()}`, { vendorId: actors.vendor.uid }, actor?.idToken), 403);
        assert.equal(await updateDocument(settlementPath, { amount: 1 }, actor?.idToken), 403);
        assert.equal(await deleteDocument(settlementPath, actor?.idToken), 403);
      }
    });

    await t.test("vendor applications require self identity and remain immutable after creation", async () => {
      const application = validApplication(actors.phoneCustomer);
      assert.equal(await createDocument("vendorApplications", actors.phoneCustomer.uid, application, actors.phoneCustomer.idToken), 200);
      seededPaths.add(`vendorApplications/${actors.phoneCustomer.uid}`);
      assert.equal(await readDocument(`vendorApplications/${actors.phoneCustomer.uid}`, undefined), 403);
      assert.equal(await readDocument(`vendorApplications/${actors.phoneCustomer.uid}`, actors.phoneCustomer.idToken), 200);
      assert.equal(await readDocument(`vendorApplications/${actors.phoneCustomer.uid}`, actors.otherCustomer.idToken), 403);
      assert.equal(await readDocument(`vendorApplications/${actors.phoneCustomer.uid}`, actors.admin.idToken), 200);
      assert.equal(await createDocument("vendorApplications", actors.otherCustomer.uid, validApplication(actors.phoneCustomer), actors.phoneCustomer.idToken), 403);
      assert.equal(await createDocument("vendorApplications", actors.customer.uid, validApplication(actors.customer), actors.customer.idToken), 403,
        "application creation requires a verified phone-number claim");
      assert.equal(await updateDocument(`vendorApplications/${actors.phoneCustomer.uid}`, { status: "approved" }, actors.phoneCustomer.idToken), 403);
      assert.equal(await deleteDocument(`vendorApplications/${actors.phoneCustomer.uid}`, actors.phoneCustomer.idToken), 403);
      assert.equal(await updateDocument(`vendorApplications/${actors.phoneCustomer.uid}`, { status: "approved" }, actors.admin.idToken), 403);
      assert.equal(await deleteDocument(`vendorApplications/${actors.phoneCustomer.uid}`, actors.admin.idToken), 403);
      assert.equal(await createDocument("vendorApplications", `wrong-phone-${suffix}`, {
        ...application,
        vendorId: `wrong-phone-${suffix}`,
        phone: "+919999000099",
      }, actors.phoneCustomer.idToken), 403);
    });

    await t.test("seller submissions enforce approved-vendor ownership and rejected-only resubmission", async () => {
      const ownPath = `sellerSubmissions/${ids.rejectedSubmission}`;
      assert.equal(await createDocument("sellerSubmissions", `new-${suffix}`, validSubmission(actors.vendor), actors.vendor.idToken), 200);
      seededPaths.add(`sellerSubmissions/new-${suffix}`);
      assert.equal(await createDocument("sellerSubmissions", `pending-${suffix}`, validSubmission(actors.pendingVendor), actors.pendingVendor.idToken), 403);
      assert.equal(await createDocument("sellerSubmissions", `cross-${suffix}`, validSubmission(actors.vendor, { sellerId: actors.otherVendor.uid }), actors.vendor.idToken), 403);
      assert.equal(await createDocument("sellerSubmissions", `bad-gst-${suffix}`, validSubmission(actors.vendor, { gstRate: 0 }), actors.vendor.idToken), 403);
      assert.equal(await createDocument("sellerSubmissions", `bad-images-${suffix}`, validSubmission(actors.vendor, { images: [] }), actors.vendor.idToken), 403);

      assert.equal(await readDocument(`sellerSubmissions/${ids.submission}`, undefined), 403);
      assert.equal(await readDocument(`sellerSubmissions/${ids.submission}`, actors.vendor.idToken), 200);
      assert.equal(await readDocument(`sellerSubmissions/${ids.submission}`, actors.otherVendor.idToken), 403);
      assert.equal(await readDocument(`sellerSubmissions/${ids.submission}`, actors.admin.idToken), 200);
      assert.equal(await queryCollection("sellerSubmissions", "sellerId", actors.vendor.uid, actors.vendor.idToken), 200);
      assert.equal(await queryCollection("sellerSubmissions", "sellerId", actors.otherVendor.uid, actors.vendor.idToken), 403);
      assert.equal(await updateDocument(ownPath, { status: "pending", rejectionReason: "", resubmittedAt: "emulator-test" }, actors.vendor.idToken), 200);
      assert.equal(await updateDocument(`sellerSubmissions/${ids.submission}`, { status: "rejected" }, actors.vendor.idToken), 403,
        "a non-rejected submission must not be resubmitted");
      assert.equal(await updateDocument(ownPath, { sellerId: actors.otherVendor.uid }, actors.vendor.idToken), 403);
      assert.equal(await updateDocument(ownPath, { status: "pending" }, actors.admin.idToken), 403);
      assert.equal(await deleteDocument(ownPath, actors.vendor.idToken), 403);
      assert.equal(await deleteDocument(ownPath, actors.admin.idToken), 403);
    });

    await t.test("vendor product links allow owner/admin reads and admin-only management", async () => {
      const path = `vendorProductLinks/${ids.vendorLink}`;
      assert.equal(await readDocument(path, undefined), 403);
      assert.equal(await readDocument(path, actors.customer.idToken), 403);
      assert.equal(await readDocument(path, actors.vendor.idToken), 200);
      assert.equal(await readDocument(path, actors.otherVendor.idToken), 403);
      assert.equal(await readDocument(path, actors.admin.idToken), 200);
      assert.equal(await updateDocument(path, { productId: "other" }, actors.vendor.idToken), 403);
      assert.equal(await deleteDocument(path, actors.vendor.idToken), 403);
      assert.equal(await createDocument("vendorProductLinks", `new-${suffix}`, { vendorId: actors.vendor.uid }, actors.vendor.idToken), 403);
      assert.equal(await updateDocument(path, { productId: "admin-update" }, actors.admin.idToken), 200);
      assert.equal(await deleteDocument(path, actors.admin.idToken), 200);
    });

    await t.test("returns, audit logs, coupons, and settings retain their intended read/write roles", async () => {
      const returnPath = `returnRequests/${ids.returnRequest}`;
      assert.equal(await readDocument(returnPath, actors.customer.idToken), 200);
      assert.equal(await readDocument(returnPath, actors.otherCustomer.idToken), 403);
      assert.equal(await readDocument(returnPath, actors.admin.idToken), 200);
      assert.equal(await readDocument(`adminAuditLogs/${ids.auditLog}`, actors.customer.idToken), 403);
      assert.equal(await readDocument(`adminAuditLogs/${ids.auditLog}`, actors.admin.idToken), 200);

      for (const actor of [undefined, actors.customer, actors.vendor, actors.admin]) {
        for (const [collection, id] of [
          ["returnRequests", ids.returnRequest],
          ["adminAuditLogs", ids.auditLog],
        ]) {
          assert.equal(await createDocument(collection, `new-${randomUUID()}`, { userId: actors.customer.uid }, actor?.idToken), 403);
          assert.equal(await updateDocument(`${collection}/${id}`, { status: "changed" }, actor?.idToken), 403);
          assert.equal(await deleteDocument(`${collection}/${id}`, actor?.idToken), 403);
        }
      }

      assert.equal(await readDocument(`categories/${ids.category}`, undefined), 200);
      assert.equal(await createDocument("categories", `new-${suffix}`, { name: "Admin category" }, actors.admin.idToken), 200);
      seededPaths.add(`categories/new-${suffix}`);
      assert.equal(await updateDocument(`categories/new-${suffix}`, { name: "Updated category" }, actors.admin.idToken), 200);
      assert.equal(await deleteDocument(`categories/new-${suffix}`, actors.admin.idToken), 200);
      seededPaths.delete(`categories/new-${suffix}`);
      assert.equal(await createDocument("categories", `denied-${suffix}`, { name: "Customer category" }, actors.customer.idToken), 403);

      assert.equal(await createDocument("settings", `admin-${suffix}`, { value: "created" }, actors.admin.idToken), 200);
      seededPaths.add(`settings/admin-${suffix}`);
      assert.equal(await updateDocument(`settings/admin-${suffix}`, { value: "updated" }, actors.admin.idToken), 200);
      assert.equal(await deleteDocument(`settings/admin-${suffix}`, actors.admin.idToken), 200);
      seededPaths.delete(`settings/admin-${suffix}`);
      assert.equal(await readDocument(`settings/${ids.setting}`, actors.customer.idToken), 403);
      assert.equal(await readDocument(`settings/${ids.setting}`, actors.admin.idToken), 200);
      assert.equal(await updateDocument(`settings/${ids.setting}`, { value: "admin-update" }, actors.admin.idToken), 200);
      assert.equal(await updateDocument(`settings/${ids.storeSetting}`, { value: "forbidden-store-update" }, actors.admin.idToken), 403);
      assert.equal(await createDocument("settings", `customer-${suffix}`, { value: "no" }, actors.customer.idToken), 403);
    });

    await t.test("presence permits only owner timestamp writes and admin reads", async () => {
      const customerPresence = `presence/${actors.customer.uid}`;
      assert.equal(await readDocument(customerPresence, undefined), 403);
      assert.equal(await readDocument(customerPresence, actors.customer.idToken), 403);
      assert.equal(await readDocument(customerPresence, actors.admin.idToken), 200);
      const otherPresence = `presence/${actors.otherCustomer.uid}`;
      assert.equal(await serverTimestampWrite(otherPresence, actors.otherCustomer.idToken, {
        lastSeen: true,
        updatedAt: true,
      }), 200);
      assert.equal(await serverTimestampWrite(otherPresence, actors.otherCustomer.idToken, {
        lastSeen: true,
        updatedAt: true,
      }), 200);
      assert.equal(await deleteDocument(otherPresence, actors.otherCustomer.idToken), 200);
      assert.equal(await serverTimestampWrite(customerPresence, actors.customer.idToken, {
        lastSeen: true,
        updatedAt: true,
      }), 200);
      assert.equal(await serverTimestampWrite(`presence/${actors.otherCustomer.uid}`, actors.customer.idToken, {
        lastSeen: true,
        updatedAt: true,
      }), 403);
      assert.equal(await serverTimestampWrite(`presence/${actors.customer.uid}`, actors.admin.idToken, {
        lastSeen: true,
        updatedAt: true,
      }), 403, "admin status does not grant another user's presence write");
      assert.equal(await updateDocument(customerPresence, { lastSeen: "client-clock" }, actors.customer.idToken), 403);
      assert.equal(await serverTimestampWrite(customerPresence, actors.customer.idToken, {
        lastSeen: true,
        updatedAt: true,
        role: true,
      }), 403);
      assert.equal(await deleteDocument(customerPresence, actors.customer.idToken), 200);
    });

    await t.test("backend-only collections and catch-all remain inaccessible", async () => {
      for (const [collection, id] of [
        ["phoneVerificationEvents", ids.phoneEvent],
        ["legalAcceptances", ids.legalAcceptance],
        ["reviews", ids.review],
        ["couponCounters", ids.counter],
        ["couponUsage", ids.usage],
        ["unlistedCollection", ids.unknown],
      ]) {
        for (const actor of [undefined, actors.customer, actors.vendor, actors.admin]) {
          const path = `${collection}/${id}`;
          assert.equal(await readDocument(path, actor?.idToken), 403);
          assert.equal(await createDocument(collection, `new-${randomUUID()}`, { value: "client" }, actor?.idToken), 403);
          assert.equal(await updateDocument(path, { value: "client" }, actor?.idToken), 403);
          assert.equal(await deleteDocument(path, actor?.idToken), 403);
        }
      }

      for (const [collection, id] of [["coupons", ids.coupon], ["couponCampaigns", ids.campaign]]) {
        assert.equal(await readDocument(`${collection}/${id}`, actors.customer.idToken), 403);
        assert.equal(await readDocument(`${collection}/${id}`, actors.admin.idToken), 200);
        assert.equal(await updateDocument(`${collection}/${id}`, { enabled: true }, actors.admin.idToken), 403);
        assert.equal(await deleteDocument(`${collection}/${id}`, actors.admin.idToken), 403);
      }
    });
  } finally {
    await Promise.all([...seededPaths].map((path) => database.doc(path).delete().catch(() => {})));
    await Promise.all(accounts.map((uid) => auth.deleteUser(uid).catch(() => {})));
    await app.delete();
  }
});
