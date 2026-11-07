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

async function emulatorRequest(host, path, options = {}) {
  const response = await fetch(`http://${host}${path}`, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function createAccount(email) {
  const { response, body } = await emulatorRequest(
    authHost,
    "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-key",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  assert.equal(response.ok, true, `Auth emulator sign-up failed: ${JSON.stringify(body)}`);
  return body;
}

async function readProduct(id, token) {
  const { response, body } = await emulatorRequest(
    firestoreHost,
    `/v1/projects/${projectId}/databases/(default)/documents/products/${id}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  return { status: response.status, body };
}

async function readReview(id, token) {
  const { response, body } = await emulatorRequest(
    firestoreHost,
    `/v1/projects/${projectId}/databases/(default)/documents/reviews/${id}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  return { status: response.status, body };
}

async function readFirestoreDocument(collection, id, token) {
  const { response, body } = await emulatorRequest(
    firestoreHost,
    `/v1/projects/${projectId}/databases/(default)/documents/${collection}/${id}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  return { status: response.status, body };
}

async function updateProduct(id, token) {
  const { response } = await emulatorRequest(
    firestoreHost,
    `/v1/projects/${projectId}/databases/(default)/documents/products/${id}?updateMask.field=name`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: { name: { stringValue: "Unauthorized update" } } }),
    },
  );
  return response.status;
}

test("Firestore raw product reads are private except for admins and the approved owning vendor", {
  skip: !emulatorConfigured && "Run with the isolated demo-project Firebase Auth and Firestore emulators.",
}, async () => {
  assert.ok(projectId.startsWith("demo-"), "This test must only use a local demo project.");
  assert.ok(isLoopbackHost(firestoreHost) && isLoopbackHost(authHost), "This test must only use local emulators.");
  const suffix = randomUUID();
  process.env.FIREBASE_PROJECT_ID = projectId;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const { cert, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const firebaseApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail: `launch-gate-${suffix}@example.test`,
      privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    }),
    projectId,
  }, `launch-gate-${suffix}`);
  const auth = getAuth(firebaseApp);
  const database = getFirestore(firebaseApp);
  const accounts = [];
  const userIds = [];
  const productIds = [
    `launch-gate-own-${suffix}`,
    `launch-gate-other-${suffix}`,
    `launch-gate-unowned-${suffix}`,
  ];
  const reviewId = `launch-gate-review-${suffix}`;
  const enquiryId = `launch-gate-enquiry-${suffix}`;
  const acceptanceId = `launch-gate-acceptance-${suffix}`;

  try {
    const customer = await createAccount(`launch-customer-${suffix}@example.test`);
    accounts.push(customer);
    userIds.push(customer.localId);
    const vendor = await createAccount(`launch-vendor-${suffix}@example.test`);
    accounts.push(vendor);
    userIds.push(vendor.localId);
    const otherVendor = await createAccount(`launch-other-vendor-${suffix}@example.test`);
    accounts.push(otherVendor);
    userIds.push(otherVendor.localId);
    const inactiveVendors = [];
    for (const vendorStatus of ["pending", "rejected", "suspended"]) {
      const inactiveVendor = await createAccount(`launch-${vendorStatus}-${suffix}@example.test`);
      accounts.push(inactiveVendor);
      userIds.push(inactiveVendor.localId);
      inactiveVendors.push({ ...inactiveVendor, vendorStatus });
    }
    const adminEmail = `launch-admin-${suffix}@example.test`;
    const admin = await createAccount(adminEmail);
    accounts.push(admin);
    await auth.setCustomUserClaims(admin.localId, { admin: true });
    const adminSignIn = await emulatorRequest(
      authHost,
      "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: adminEmail, password, returnSecureToken: true }),
      },
    );
    assert.equal(adminSignIn.response.ok, true, `Admin emulator sign-in failed: ${JSON.stringify(adminSignIn.body)}`);
    assert.deepEqual((await auth.getUser(admin.localId)).customClaims, { admin: true });
    await database.collection("users").doc(customer.localId).set({ role: "customer" });
    await database.collection("users").doc(vendor.localId).set({ role: "vendor", vendorStatus: "approved" });
    await database.collection("users").doc(otherVendor.localId).set({ role: "vendor", vendorStatus: "approved" });
    await Promise.all([
      database.collection("products").doc(productIds[0]).set({
        name: "Private vendor product",
        sellerId: vendor.localId,
        sellerType: "vendor",
        status: "pending",
        enabled: false,
        vendorEmail: "private@example.test",
        vendorImportKey: "private-key",
      }),
      database.collection("products").doc(productIds[1]).set({
        name: "Another vendor product",
        sellerId: otherVendor.localId,
        sellerType: "vendor",
      }),
      database.collection("products").doc(productIds[2]).set({
        name: "Product without ownership",
        status: "pending",
        enabled: false,
      }),
      ...inactiveVendors.map(({ localId, vendorStatus }) =>
        database.collection("users").doc(localId).set({ role: "vendor", vendorStatus }),
      ),
      database.collection("reviews").doc(reviewId).set({
        productId: productIds[0],
        userId: customer.localId,
        userName: "Emulator customer",
        rating: 5,
        text: "Synthetic emulator review",
      }),
      database.collection("vendorEnquiries").doc(enquiryId).set({
        buyerId: customer.localId,
        vendorId: vendor.localId,
        buyerEmail: "synthetic@example.test",
        buyerMessage: "Synthetic private enquiry",
      }),
      database.collection("legalAcceptances").doc(acceptanceId).set({
        uid: customer.localId,
        policyVersions: { privacy: "test-version" },
      }),
      database.doc("settings/assistant").set({
        supportPhone: "synthetic-private-settings-marker",
      }),
    ]);

    for (const productId of productIds) {
      assert.equal((await readProduct(productId)).status, 403, "anonymous raw product reads must always be denied");
      assert.equal((await readProduct(productId, customer.idToken)).status, 403, "customer raw product reads must be denied");
      assert.equal((await readProduct(productId, vendor.idToken)).status, productId === productIds[0] ? 200 : 403,
        "vendors may read only their own products");
      assert.equal((await readProduct(productId, adminSignIn.body.idToken)).status, 200,
        "an admin custom claim must preserve product-management access");
      assert.equal(await updateProduct(productId, vendor.idToken), 403,
        "vendors must not modify even their own raw product documents");
      assert.equal(await updateProduct(productId, otherVendor.idToken), 403,
        "vendors must not modify another vendor's raw product documents");
      for (const inactiveVendor of inactiveVendors) {
        assert.equal((await readFirestoreDocument("products", productId, inactiveVendor.idToken)).status, 403,
          `${inactiveVendor.vendorStatus} vendors must not read raw product documents`);
      }
    }

    for (const [label, token] of [
      ["anonymous", undefined],
      ["customer", customer.idToken],
      ["approved vendor", vendor.idToken],
      ...inactiveVendors.map(({ vendorStatus, idToken }) => [`${vendorStatus} vendor`, idToken]),
      ["admin", adminSignIn.body.idToken],
    ]) {
      assert.equal((await readReview(reviewId, token)).status, 403,
        `${label} direct Firestore review reads must remain denied`);
      for (const [collection, id] of [
        ["vendorEnquiries", enquiryId],
        ["legalAcceptances", acceptanceId],
      ]) {
        assert.equal((await readFirestoreDocument(collection, id, token)).status, 403,
          `${label} direct Firestore ${collection} reads must remain denied`);
      }
      assert.equal((await readFirestoreDocument("settings", "assistant", token)).status, label === "admin" ? 200 : 403,
        `${label} must not directly read customer-facing assistant settings`);
    }
  } finally {
    await Promise.all([
      ...productIds.map((productId) => database.collection("products").doc(productId).delete()),
      database.collection("reviews").doc(reviewId).delete(),
      database.collection("vendorEnquiries").doc(enquiryId).delete(),
      database.collection("legalAcceptances").doc(acceptanceId).delete(),
      database.doc("settings/assistant").delete(),
    ]);
    for (const account of accounts) {
      const { response, body } = await emulatorRequest(
        authHost,
        "/identitytoolkit.googleapis.com/v1/accounts:delete?key=local-emulator-key",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: account.idToken }),
        },
      );
      assert.equal(response.ok, true, `Auth emulator cleanup failed: ${JSON.stringify(body)}`);
    }
    await Promise.all(userIds.map((uid) =>
      database.collection("users").doc(uid).delete(),
    ));
    await firebaseApp.delete();
  }
});
