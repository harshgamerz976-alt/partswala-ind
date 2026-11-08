import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { fcmTokenDocumentId } from "./notifications.js";

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
  const createdTokenIds = new Set();
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
      mrp: 15000,
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
    for (const uid of createdUserIds) {
      for (const subcollection of ["notifications", "fcmTokens"]) {
        const snapshot = await database.collection("users").doc(uid).collection(subcollection).get();
        await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
      }
    }
    await Promise.all([
      ...createdEnquiryIds.map((id) => database.collection("vendorEnquiries").doc(id).delete()),
      ...createdProductIds.map((id) => database.collection("products").doc(id).delete()),
      ...[...createdTokenIds].map((id) => database.collection("fcmTokenOwners").doc(id).delete()),
      ...["supplierEnquiryRequests", "supplierQuoteRequests"].flatMap((collectionName) =>
        createdUserIds.map(async (uid) => {
          const snapshot = await database.collection(collectionName).where("userId", "==", uid).get();
          await Promise.all(snapshot.docs.map((document) => document.ref.delete()));
        })),
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
    const enquiryRequestId = randomUUID();

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
          sellingPrice: 1,
          shareEmail: false,
          requestId: enquiryRequestId,
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
      assert.equal(stored.sellingPrice, 12500);
      assert.equal(stored.quantity, 3);
      const vendorNotifications = await database.collection("users").doc(ownerVendor.uid).collection("notifications").get();
      assert.equal(vendorNotifications.size, 1);
      assert.equal(vendorNotifications.docs[0].data().type, "vendor-enquiry");
      assert.equal(vendorNotifications.docs[0].data().enquiryId, privateEnquiryId);
      const buyerList = await apiRequest("/api/enquiries", { token: buyer.token });
      assert.equal(buyerList.body.enquiries.find(({ id }) => id === privateEnquiryId).sellingPrice, 12500);
      const duplicateRequests = await Promise.all(Array.from({ length: 2 }, () => apiRequest("/api/vendor/enquiries", {
        method: "POST",
        token: buyer.token,
        body: {
          productId: eligibleProductId,
          quantity: 3,
          message: "Please quote this part.",
          requestId: enquiryRequestId,
        },
      })));
      assert.deepEqual(duplicateRequests.map(({ status }) => status), [201, 201]);
      assert.deepEqual(duplicateRequests.map(({ body }) => body.enquiryId), [privateEnquiryId, privateEnquiryId]);
      assert.equal((await database.collection("users").doc(ownerVendor.uid).collection("notifications").get()).size, 1);
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
      assert.equal((await database.collection("users").doc(ownerVendor.uid).collection("notifications").get()).size, 2);
    });

    await t.test("approved vendors can submit enquiries as buyers", async () => {
      const response = await apiRequest("/api/vendor/enquiries", {
        method: "POST",
        token: otherVendor.token,
        body: {
          productId: eligibleProductId,
          quantity: 2,
          message: "Please quote this part for my business.",
          requestId: randomUUID(),
        },
      });
      assert.equal(response.status, 201);
      const vendorBuyerEnquiryId = response.body.enquiryId;
      createdEnquiryIds.push(vendorBuyerEnquiryId);

      const stored = (await database.collection("vendorEnquiries").doc(vendorBuyerEnquiryId).get()).data();
      assert.equal(stored.buyerId, otherVendor.uid);
      assert.equal(stored.vendorId, ownerVendor.uid);
      assert.equal((await apiRequest("/api/enquiries", { token: otherVendor.token })).body.enquiries
        .some(({ id }) => id === vendorBuyerEnquiryId), true);
      assert.equal((await apiRequest("/api/vendor/enquiries", { token: ownerVendor.token })).body.enquiries
        .some(({ id }) => id === vendorBuyerEnquiryId), true);
      assert.equal((await database.collection("users").doc(ownerVendor.uid).collection("notifications").get()).size, 3);
      assert.equal((await database.collection("users").doc(otherVendor.uid).collection("notifications").get()).size, 0);
    });

    await t.test("buyer and vendor enquiry lists are restricted to their respective owners", async () => {
      const buyerResults = await apiRequest("/api/enquiries", { token: buyer.token });
      assert.equal(buyerResults.status, 200);
      assert.deepEqual(buyerResults.body.enquiries.map(({ id }) => id).sort(), [privateEnquiryId, consentedEnquiryId].sort());
      assert.equal("buyerEmail" in buyerResults.body.enquiries[0], false);
      assert.equal((await apiRequest("/api/enquiries", { token: otherBuyer.token })).body.enquiries.length, 0);
      const vendorResults = await apiRequest("/api/vendor/enquiries", { token: ownerVendor.token });
      assert.equal(vendorResults.status, 200);
      assert.equal(vendorResults.body.enquiries.length, 3);
      assert.equal(vendorResults.body.enquiries.find(({ id }) => id === privateEnquiryId).sellingPrice, 12500);
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
      assert.equal((await apiRequest(`/api/enquiries/${privateEnquiryId}`, { token: otherBuyer.token })).status, 404);
      assert.equal((await apiRequest(`/api/vendor/enquiries/${privateEnquiryId}`, { token: otherVendor.token })).status, 404);
    });

    await t.test("notification reads are owner-scoped and token registrations can be reassigned and removed", async () => {
      const notificationId = "seeded-notification";
      await database.collection("users").doc(ownerVendor.uid).collection("notifications").doc(notificationId).set({
        title: "Existing notification",
        message: "Notification endpoints remain independent of enquiry creation.",
        read: false,
        createdAt: new Date().toISOString(),
      });
      const notificationSnapshot = await database.collection("users").doc(ownerVendor.uid).collection("notifications").get();
      assert.equal(notificationSnapshot.size, 4);
      assert.equal((await apiRequest(`/api/notifications/${notificationId}/read`, {
        method: "PATCH",
        token: otherVendor.token,
      })).status, 404);
      assert.equal((await apiRequest(`/api/notifications/${notificationId}/read`, {
        method: "PATCH",
        token: ownerVendor.token,
      })).status, 200);
      assert.equal((await database.collection("users").doc(ownerVendor.uid).collection("notifications").doc(notificationId).get()).data().read, true);

      await database.collection("users").doc(ownerVendor.uid).collection("notifications").doc("second-test-notification").set({
        title: "Another update",
        message: "A second saved update.",
        read: false,
        createdAt: new Date().toISOString(),
      });
      const readAll = await apiRequest("/api/notifications/read-all", { method: "PATCH", token: ownerVendor.token });
      assert.equal(readAll.status, 200);
      assert.equal(readAll.body.updated, 4);
      assert.equal((await database.collection("users").doc(ownerVendor.uid).collection("notifications").doc("second-test-notification").get()).data().read, true);

      const token = `synthetic-fcm-token-${randomUUID()}`;
      const tokenId = fcmTokenDocumentId(token);
      createdTokenIds.add(tokenId);
      const registration = await apiRequest("/api/notifications/fcm-token", {
        method: "POST",
        token: ownerVendor.token,
        body: { token },
      });
      assert.equal(registration.status, 200);
      assert.equal(JSON.stringify(registration.body).includes(token), false);
      assert.equal((await database.collection("users").doc(ownerVendor.uid).collection("fcmTokens").doc(tokenId).get()).data().token, token);

      assert.equal((await apiRequest("/api/notifications/fcm-token", {
        method: "POST",
        token: otherVendor.token,
        body: { token },
      })).status, 200);
      assert.equal((await database.collection("users").doc(ownerVendor.uid).collection("fcmTokens").doc(tokenId).get()).exists, false);
      assert.equal((await database.collection("fcmTokenOwners").doc(tokenId).get()).data().userId, otherVendor.uid);

      await apiRequest("/api/notifications/fcm-token", { method: "DELETE", token: ownerVendor.token, body: { token } });
      assert.equal((await database.collection("users").doc(otherVendor.uid).collection("fcmTokens").doc(tokenId).get()).exists, true);
      assert.equal((await apiRequest("/api/notifications/fcm-token", {
        method: "DELETE",
        token: otherVendor.token,
        body: { token },
      })).status, 200);
      assert.equal((await database.collection("users").doc(otherVendor.uid).collection("fcmTokens").doc(tokenId).get()).exists, false);
      assert.equal((await database.collection("fcmTokenOwners").doc(tokenId).get()).exists, false);
      assert.equal((await apiRequest("/api/notifications/fcm-token", {
        method: "POST",
        token: admin.token,
        body: { token: "admin-token" },
      })).status, 403);
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
      const quoteRequestId = randomUUID();
      const quoteBody = {
        amount: 1234.567,
        message: "Price valid for this request.",
        status: "closed",
        vendorId: otherVendor.uid,
        requestId: quoteRequestId,
      };
      const quotes = await Promise.all(Array.from({ length: 2 }, () => apiRequest(
        `/api/vendor/enquiries/${privateEnquiryId}/quote`,
        { method: "PATCH", token: ownerVendor.token, body: quoteBody },
      )));
      const quote = quotes[0];
      assert.deepEqual(quotes.map(({ status }) => status), [200, 200]);
      assert.equal(quote.status, 200);
      assert.equal(quote.body.status, "quoted");
      assert.equal(quote.body.quoteAmount, 1234.57);
      const stored = (await database.collection("vendorEnquiries").doc(privateEnquiryId).get()).data();
      assert.equal(stored.vendorId, ownerVendor.uid);
      assert.equal(stored.status, "quoted");
      assert.equal(stored.quoteAmount, 1234.57);
      assert.equal(stored.quoteCurrency, "INR");
      const changedReplay = await apiRequest(`/api/vendor/enquiries/${privateEnquiryId}/quote`, {
        method: "PATCH",
        token: ownerVendor.token,
        body: { ...quoteBody, amount: 9999, message: "Changed retry payload." },
      });
      assert.equal(changedReplay.status, 200);
      assert.equal(changedReplay.body.quoteAmount, 1234.57);
      assert.equal((await database.collection("vendorEnquiries").doc(privateEnquiryId).get()).data().quoteAmount, 1234.57);
      const customerNotifications = await database.collection("users").doc(buyer.uid).collection("notifications").where("type", "==", "customer-reply").get();
      assert.equal(customerNotifications.size, 1);
      const duplicateQuote = await apiRequest(`/api/vendor/enquiries/${privateEnquiryId}/quote`, {
        method: "PATCH",
        token: ownerVendor.token,
        body: quoteBody,
      });
      assert.equal(duplicateQuote.status, 200);
      assert.equal((await database.collection("users").doc(buyer.uid).collection("notifications").where("type", "==", "customer-reply").get()).size, 1);
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
