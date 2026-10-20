import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
const isLoopbackHost = (value) => /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value);
const emulatorConfigured = projectId.startsWith("demo-")
  && isLoopbackHost(firestoreHost)
  && isLoopbackHost(authHost);

async function emulatorRequest(host, path, options) {
  const response = await fetch(`http://${host}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Firebase emulator request failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

test("supplier enquiry routes enforce auth, ownership, eligibility, and quote rules in local emulators", {
  skip: !emulatorConfigured && "Run with the configured demo-project Firebase emulators.",
}, async (t) => {
  assert.equal(projectId.startsWith("demo-"), true);
  assert.equal(isLoopbackHost(firestoreHost), true);
  assert.equal(isLoopbackHost(authHost), true);

  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
  process.env.FIREBASE_CLIENT_EMAIL = "supplier-enquiry-test@example.test";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).replace(/\n/g, "\\n");

  const { cert, getApps, initializeApp } = await import("firebase-admin/app");
  const firebaseApp = getApps().find(({ name }) => name === "[DEFAULT]") || initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
    projectId,
  });
  assert.equal(firebaseApp.options.projectId, projectId);

  const { default: app } = await import("./server.js");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const auth = getAuth(firebaseApp);
  const database = getFirestore(firebaseApp);
  const createdUserIds = [];
  const createdProductIds = [];
  const createdEnquiryIds = [];
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  const api = `http://127.0.0.1:${address.port}`;

  async function createAccount(role, vendorStatus = "") {
    const email = `${role}-${randomUUID()}@example.test`;
    const account = await emulatorRequest(
      authHost,
      "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "LocalEmulatorPass123!", returnSecureToken: true }),
      },
    );
    createdUserIds.push(account.localId);
    await database.collection("users").doc(account.localId).set({
      role,
      ...(role === "vendor" ? {
        vendorStatus,
        vendorProfile: { businessName: `Business ${account.localId.slice(0, 8)}` },
      } : {}),
    });
    return { uid: account.localId, email, token: account.idToken };
  }

  async function createAdmin() {
    const account = await createAccount("admin");
    await auth.setCustomUserClaims(account.uid, { admin: true });
    const signedIn = await emulatorRequest(
      authHost,
      "/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: account.email, password: "LocalEmulatorPass123!", returnSecureToken: true }),
      },
    );
    return { ...account, token: signedIn.idToken };
  }

  async function createProduct(seller, fields = {}) {
    const reference = await database.collection("products").add({
      name: "Emulator clutch assembly",
      partNumber: "TEST-CLUTCH-1",
      price: 12500,
      sellerId: seller.uid,
      sellerType: "vendor",
      enabled: true,
      status: "Available",
      ...fields,
    });
    createdProductIds.push(reference.id);
    return reference.id;
  }

  async function apiRequest(path, { token, method = "GET", body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(`${api}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }

  async function cleanup() {
    await Promise.all([
      ...createdEnquiryIds.map((id) => database.collection("vendorEnquiries").doc(id).delete()),
      ...createdProductIds.map((id) => database.collection("products").doc(id).delete()),
      ...createdUserIds.map((uid) => database.collection("users").doc(uid).delete()),
      ...createdUserIds.map((uid) => auth.deleteUser(uid)),
    ]);
  }

  try {
    const buyer = await createAccount("customer");
    const otherBuyer = await createAccount("customer");
    const revokedBuyer = await createAccount("customer");
    const ownerVendor = await createAccount("vendor", "approved");
    const otherVendor = await createAccount("vendor", "approved");
    const pendingVendor = await createAccount("vendor", "pending");
    const admin = await createAdmin();
    const eligibleProductId = await createProduct(ownerVendor);
    const pendingProductId = await createProduct(ownerVendor, { status: "pending", enabled: false });
    const conflictingProductId = await createProduct(ownerVendor, { status: "Available", approvalStatus: "pending" });

    await t.test("signed-out and non-customer/admin accounts cannot use buyer routes", async () => {
      assert.equal((await apiRequest("/api/enquiries")).status, 401);
      assert.equal((await apiRequest("/api/vendor/enquiries")).status, 401);
      assert.equal((await apiRequest("/api/vendor/enquiries/enquiry/quote", {
        method: "PATCH",
        body: { amount: 1, message: "Quote" },
      })).status, 401);
      assert.equal((await apiRequest("/api/vendor/enquiries", { token: buyer.token })).status, 403);
      assert.equal((await apiRequest("/api/enquiries", { token: admin.token })).status, 403);
      assert.equal((await apiRequest("/api/vendor/enquiries", { token: admin.token })).status, 403);
      assert.equal((await apiRequest("/api/enquiries", { token: pendingVendor.token })).status, 403);
      assert.equal((await apiRequest("/api/enquiries", { token: revokedBuyer.token })).status, 200);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await auth.revokeRefreshTokens(revokedBuyer.uid);
      assert.equal((await apiRequest("/api/enquiries", { token: revokedBuyer.token })).status, 401);
    });

    await t.test("vendor-name POST returns only eligible published vendor product IDs", async () => {
      const response = await apiRequest("/api/products/vendor-names", {
        method: "POST",
        body: { productIds: [eligibleProductId, pendingProductId, conflictingProductId] },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.eligibleProductIds, [eligibleProductId]);
      assert.equal(response.body.names[eligibleProductId], `Business ${ownerVendor.uid.slice(0, 8)}`);
      assert.equal(Object.hasOwn(response.body.names, conflictingProductId), false);
      assert.equal((await apiRequest("/api/products/vendor-names", {
        method: "POST",
        body: { productIds: ["products/invalid"] },
      })).status, 400);
    });

    let privateEnquiryId;
    let consentedEnquiryId;
    await t.test("customer creation ignores caller-controlled identity, status, and quote fields", async () => {
      const response = await apiRequest("/api/vendor/enquiries", {
        method: "POST",
        token: buyer.token,
        body: {
          productId: eligibleProductId,
          quantity: 3,
          message: "Please quote this part.",
          buyerId: otherBuyer.uid,
          vendorId: otherVendor.uid,
          buyerEmail: "attacker@example.test",
          status: "quoted",
          quoteAmount: 1,
          shareEmail: false,
        },
      });
      assert.equal(response.status, 201);
      privateEnquiryId = response.body.enquiryId;
      createdEnquiryIds.push(privateEnquiryId);
      const stored = (await database.collection("vendorEnquiries").doc(privateEnquiryId).get()).data();
      assert.equal(stored.buyerId, buyer.uid);
      assert.equal(stored.vendorId, ownerVendor.uid);
      assert.equal(stored.buyerEmail, null);
      assert.equal(stored.status, "new");
      assert.equal(stored.quoteAmount, null);
      assert.equal(stored.quantity, 3);
    });

    await t.test("buyer consent shares only the verified account email", async () => {
      const response = await apiRequest("/api/vendor/enquiries", {
        method: "POST",
        token: buyer.token,
        body: {
          productId: eligibleProductId,
          quantity: 1,
          message: "Please contact me with a quote.",
          shareEmail: true,
          buyerEmail: "attacker@example.test",
        },
      });
      assert.equal(response.status, 201);
      consentedEnquiryId = response.body.enquiryId;
      createdEnquiryIds.push(consentedEnquiryId);
      const stored = (await database.collection("vendorEnquiries").doc(consentedEnquiryId).get()).data();
      assert.equal(stored.buyerEmail, buyer.email);
    });

    await t.test("buyer and vendor enquiry lists are restricted to their respective owners", async () => {
      const buyerResults = await apiRequest("/api/enquiries", { token: buyer.token });
      assert.equal(buyerResults.status, 200);
      assert.deepEqual(buyerResults.body.enquiries.map(({ id }) => id).sort(), [privateEnquiryId, consentedEnquiryId].sort());
      assert.equal("buyerEmail" in buyerResults.body.enquiries[0], false);
      assert.equal((await apiRequest("/api/enquiries", { token: otherBuyer.token })).body.enquiries.length, 0);
      const vendorResults = await apiRequest("/api/vendor/enquiries", { token: ownerVendor.token });
      assert.equal(vendorResults.status, 200);
      assert.equal(vendorResults.body.enquiries.length, 2);
      assert.equal(vendorResults.body.enquiries.find(({ id }) => id === privateEnquiryId).buyerEmail, null);
      assert.equal(vendorResults.body.enquiries.find(({ id }) => id === consentedEnquiryId).buyerEmail, buyer.email);
      assert.equal((await apiRequest("/api/vendor/enquiries", { token: otherVendor.token })).body.enquiries.length, 0);
      assert.equal((await apiRequest("/api/vendor/enquiries", { token: pendingVendor.token })).status, 403);
      assert.equal((await apiRequest(`/api/enquiries?cursor=${encodeURIComponent(privateEnquiryId)}`, {
        token: otherBuyer.token,
      })).status, 400);
      assert.equal((await apiRequest(`/api/vendor/enquiries?cursor=${encodeURIComponent(privateEnquiryId)}`, {
        token: otherVendor.token,
      })).status, 400);
      assert.equal((await apiRequest("/api/enquiries?cursor=bad%2Fcursor", { token: buyer.token })).status, 400);
    });

    await t.test("only the approved product owner may quote; amount and status are server-controlled", async () => {
      assert.equal((await apiRequest(`/api/vendor/enquiries/${privateEnquiryId}/quote`, {
        method: "PATCH",
        token: otherVendor.token,
        body: { amount: 100, message: "Unrelated quote" },
      })).status, 403);
      assert.equal((await apiRequest(`/api/vendor/enquiries/${privateEnquiryId}/quote`, {
        method: "PATCH",
        token: pendingVendor.token,
        body: { amount: 100, message: "Pending vendor quote" },
      })).status, 403);
      assert.equal((await apiRequest(`/api/vendor/enquiries/${privateEnquiryId}/quote`, {
        method: "PATCH",
        token: buyer.token,
        body: { amount: 100, message: "Buyer quote" },
      })).status, 403);
      assert.equal((await apiRequest(`/api/vendor/enquiries/${privateEnquiryId}/quote`, {
        method: "PATCH",
        token: admin.token,
        body: { amount: 100, message: "Admin quote" },
      })).status, 403);
      const quote = await apiRequest(`/api/vendor/enquiries/${privateEnquiryId}/quote`, {
        method: "PATCH",
        token: ownerVendor.token,
        body: {
          amount: 1234.567,
          message: "Price valid for this request.",
          status: "closed",
          vendorId: otherVendor.uid,
        },
      });
      assert.equal(quote.status, 200);
      assert.equal(quote.body.status, "quoted");
      assert.equal(quote.body.quoteAmount, 1234.57);
      const stored = (await database.collection("vendorEnquiries").doc(privateEnquiryId).get()).data();
      assert.equal(stored.vendorId, ownerVendor.uid);
      assert.equal(stored.status, "quoted");
      assert.equal(stored.quoteAmount, 1234.57);
      assert.equal(stored.quoteCurrency, "INR");
      assert.equal((await apiRequest(`/api/vendor/enquiries/${privateEnquiryId}/quote`, {
        method: "PATCH",
        token: ownerVendor.token,
        body: { amount: 0, message: "Invalid amount" },
      })).status, 400);
      assert.equal((await apiRequest("/api/vendor/enquiries/a%2Fb/quote", {
        method: "PATCH",
        token: ownerVendor.token,
        body: { amount: 100, message: "Malformed ID" },
      })).status, 400);
    });

    await t.test("quantity and ineligible product records are rejected", async () => {
      assert.equal((await apiRequest("/api/vendor/enquiries", {
        method: "POST",
        token: buyer.token,
        body: { productId: eligibleProductId, quantity: 0, message: "Invalid quantity." },
      })).status, 400);
      assert.equal((await apiRequest("/api/vendor/enquiries", {
        method: "POST",
        token: buyer.token,
        body: { productId: "products/invalid", quantity: 1, message: "Malformed product ID." },
      })).status, 400);
      for (const productId of [pendingProductId, conflictingProductId]) {
        assert.equal((await apiRequest("/api/vendor/enquiries", {
          method: "POST",
          token: buyer.token,
          body: { productId, quantity: 1, message: "Please quote this part." },
        })).status, 409);
      }
      assert.equal((await apiRequest("/api/vendor/enquiries", {
        method: "POST",
        token: pendingVendor.token,
        body: { productId: eligibleProductId, quantity: 1, message: "Pending vendor." },
      })).status, 403);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await cleanup();
  }
});
