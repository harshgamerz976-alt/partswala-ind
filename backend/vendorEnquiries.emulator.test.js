import assert from "node:assert/strict";
import test from "node:test";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { once } from "node:events";
import { PARTSWALA_LAUNCH_UTC } from "../shared/preLaunch.js";

const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "";
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || "";
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || "";
const isLoopbackHost = (value) => /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value);
const emulatorConfigured = projectId.startsWith("demo-")
  && isLoopbackHost(firestoreHost)
  && isLoopbackHost(authHost);
const launchTime = Date.parse(PARTSWALA_LAUNCH_UTC);

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
  const previousLaunchClock = app.locals.launchClock;
  app.locals.launchClock = () => launchTime - 1;
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const auth = getAuth(firebaseApp);
  const database = getFirestore(firebaseApp);
  const createdUserIds = [];
  const createdProductIds = [];
  const createdEnquiryIds = [];
  const createdOrderIds = [];
  const createdSettlementIds = [];
  const createdReviewIds = [];
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
        vendorProfile: {
          businessName: `Business ${account.localId.slice(0, 8)}`,
          publicWhatsAppNumber: "919999000000",
          phone: "911111000000",
        },
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

  async function createDeliveredOrder(buyer, productId) {
    const reference = database.collection("orders").doc();
    await reference.set({
      userId: buyer.uid,
      status: "delivered",
      paymentStatus: "Paid",
      items: [{ productId }],
    });
    createdOrderIds.push(reference.id);
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
    assert.equal(response.headers.get("cache-control"), "no-store", `${method} ${path} must not be cached`);
    return {
      status: response.status,
      body: await response.json().catch(() => ({})),
      headers: response.headers,
    };
  }

  async function cleanup() {
    await Promise.all([
      ...createdEnquiryIds.map((id) => database.collection("vendorEnquiries").doc(id).delete()),
      ...createdOrderIds.map((id) => database.collection("orders").doc(id).delete()),
      ...createdSettlementIds.map((id) => database.collection("vendorSettlements").doc(id).delete()),
      ...createdReviewIds.map((id) => database.collection("reviews").doc(id).delete()),
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
    const rejectedVendor = await createAccount("vendor", "rejected");
    const suspendedVendor = await createAccount("vendor", "suspended");
    const admin = await createAdmin();
    const eligibleProductId = await createProduct(ownerVendor);
    const pendingProductId = await createProduct(ownerVendor, { status: "pending", enabled: false });
    const conflictingProductId = await createProduct(ownerVendor, { status: "Available", approvalStatus: "pending" });

    await t.test("review GET and POST follow the exact launch boundary", async () => {
      const reviewPath = `/api/reviews?productId=${eligibleProductId}`;
      const reviewBody = { productId: eligibleProductId, rating: 5, text: "Emulator launch-boundary review." };
      const reviewIdFor = (uid) => createHash("sha256").update(`${uid}:${eligibleProductId}`).digest("hex");

      app.locals.launchClock = () => launchTime - 1;
      assert.equal((await apiRequest(reviewPath)).status, 403);
      assert.equal((await apiRequest("/api/reviews", {
        method: "POST",
        token: buyer.token,
        body: reviewBody,
      })).status, 403);

      await createDeliveredOrder(buyer, eligibleProductId);
      await createDeliveredOrder(otherBuyer, eligibleProductId);

      app.locals.launchClock = () => launchTime;
      const exactLaunchRead = await apiRequest(reviewPath);
      assert.equal(exactLaunchRead.status, 200);
      assert.deepEqual(exactLaunchRead.body, { reviews: [] });
      const exactLaunchReviewId = reviewIdFor(buyer.uid);
      createdReviewIds.push(exactLaunchReviewId);
      const exactLaunchSubmission = await apiRequest("/api/reviews", {
        method: "POST",
        token: buyer.token,
        body: reviewBody,
      });
      assert.equal(exactLaunchSubmission.status, 201);
      assert.equal(exactLaunchSubmission.body.reviewId, exactLaunchReviewId);

      app.locals.launchClock = () => launchTime + 1;
      const afterLaunchRead = await apiRequest(reviewPath);
      assert.equal(afterLaunchRead.status, 200);
      assert.equal(afterLaunchRead.body.reviews.length, 1);
      const afterLaunchReviewId = reviewIdFor(otherBuyer.uid);
      createdReviewIds.push(afterLaunchReviewId);
      const afterLaunchSubmission = await apiRequest("/api/reviews", {
        method: "POST",
        token: otherBuyer.token,
        body: reviewBody,
      });
      assert.equal(afterLaunchSubmission.status, 201);
      assert.equal(afterLaunchSubmission.body.reviewId, afterLaunchReviewId);
      const orderIds = [...createdOrderIds];
      const reviewIds = [...createdReviewIds];
      await Promise.all([
        ...orderIds.map((id) => database.collection("orders").doc(id).delete()),
        ...reviewIds.map((id) => database.collection("reviews").doc(id).delete()),
      ]);
      createdOrderIds.length = 0;
      createdReviewIds.length = 0;
      app.locals.launchClock = () => launchTime - 1;
    });

    await t.test("pre-launch blocks public product, review, assistant, enquiry, checkout, and payment routes", async () => {
      const settings = await apiRequest("/api/settings/public");
      assert.equal(settings.status, 200);
      assert.deepEqual({
        preLaunchEnabled: settings.body.preLaunchEnabled,
        launchTime: settings.body.launchTime,
        millisecondsUntilLaunch: settings.body.millisecondsUntilLaunch,
      }, {
        preLaunchEnabled: true,
        launchTime: PARTSWALA_LAUNCH_UTC,
        millisecondsUntilLaunch: 1,
      });

      const blockedMessage = { message: "The PartsWalaIND marketplace is not open yet." };
      for (const path of [
        "/api/public-products",
        "/api/public-products?limit=1&category=Engine",
        "/api/public-products?after=cursor&limit=1",
        `/api/public-products/${eligibleProductId}`,
      ]) {
        const blocked = await apiRequest(path);
        assert.equal(blocked.status, 403, `${path} must remain closed before launch`);
        assert.deepEqual(blocked.body, blockedMessage, `${path} must not leak catalogue data`);
      }
      assert.equal((await apiRequest("/api/public-products", { token: admin.token })).status, 403);
      const vendorCatalogue = await apiRequest("/api/public-products?category=Engine&limit=1", {
        token: ownerVendor.token,
      });
      assert.equal(vendorCatalogue.status, 403);
      assert.deepEqual(vendorCatalogue.body, blockedMessage);
      const blockedVendorContact = await apiRequest(`/api/products/${eligibleProductId}/vendor-contact`);
      assert.equal(blockedVendorContact.status, 403);
      assert.deepEqual(blockedVendorContact.body, blockedMessage);
      const blockedVendorNames = await apiRequest("/api/products/vendor-names", {
        method: "POST",
        body: { productIds: [eligibleProductId] },
      });
      assert.equal(blockedVendorNames.status, 403);
      assert.deepEqual(blockedVendorNames.body, blockedMessage);
      const blockedReviews = await apiRequest(`/api/reviews?productId=${eligibleProductId}`);
      assert.equal(blockedReviews.status, 403);
      assert.deepEqual(blockedReviews.body, blockedMessage);
      const blockedReviewSubmission = await apiRequest("/api/reviews", {
        method: "POST",
        token: buyer.token,
        body: { productId: eligibleProductId, rating: 5, text: "Early review" },
      });
      assert.equal(blockedReviewSubmission.status, 403);
      assert.deepEqual(blockedReviewSubmission.body, blockedMessage);
      assert.equal((await apiRequest("/api/ai/chat", {
        method: "POST",
        body: { message: "Search for a clutch" },
      })).status, 403);
      assert.equal((await apiRequest("/api/ai/chat", {
        method: "POST",
        token: buyer.token,
        body: { message: "Search for a clutch" },
      })).status, 403);
      assert.equal((await apiRequest("/api/vendor/enquiries", {
        method: "POST",
        token: buyer.token,
        body: { productId: eligibleProductId, quantity: 1, message: "Please quote this part." },
      })).status, 403);
      assert.equal((await database.collection("vendorEnquiries").where("buyerId", "==", buyer.uid).get()).size, 0);
      const checkoutQuote = await apiRequest("/api/checkout/quote", {
        method: "POST",
        token: buyer.token,
        body: {},
      });
      assert.equal(checkoutQuote.status, 503);
      assert.equal(checkoutQuote.body.code, "COMMERCE_UNAVAILABLE");
      const orderCreation = await apiRequest("/api/orders", {
        method: "POST",
        token: buyer.token,
        body: {},
      });
      assert.equal(orderCreation.status, 503);
      assert.equal(orderCreation.body.code, "COMMERCE_UNAVAILABLE");
      assert.equal((await database.collection("orders").where("userId", "==", buyer.uid).get()).size, 0);
      for (const path of ["/api/phonepe/orders", "/api/razorpay/orders", "/api/razorpay/verify"]) {
        const result = await apiRequest(path, {
          method: "POST",
          token: buyer.token,
          body: {},
        });
        assert.equal(result.status, 503, `${path} must remain closed before launch`);
        assert.equal(result.body.code, "COMMERCE_UNAVAILABLE");
      }
      assert.equal((await apiRequest("/api/shiprocket/orders", {
        method: "POST",
        token: admin.token,
        body: { orderId: "no-shipment-created" },
      })).status, 503);

      assert.equal((await apiRequest("/api/admin/pickup-locations", { token: admin.token })).status, 200);
    });

    await t.test("assistant marketplace access follows server time and only allows the verified admin exception", async () => {
      const previousGeminiKey = process.env.GEMINI_API_KEY;
      const previousGroqKey = process.env.GROQ_API_KEY;
      process.env.GEMINI_API_KEY = "";
      process.env.GROQ_API_KEY = "";
      try {
        const requestAssistant = (token) => apiRequest("/api/ai/chat", {
          method: "POST",
          ...(token ? { token } : {}),
          body: { message: "Show me a clutch part." },
        });

        app.locals.launchClock = () => launchTime - 1;
        assert.equal((await requestAssistant()).status, 403);
        assert.equal((await requestAssistant(admin.token)).status, 503);

        app.locals.launchClock = () => launchTime;
        assert.equal((await requestAssistant()).status, 503);

        app.locals.launchClock = () => launchTime + 1;
        assert.equal((await requestAssistant()).status, 503);
      } finally {
        if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = previousGeminiKey;
        if (previousGroqKey === undefined) delete process.env.GROQ_API_KEY;
        else process.env.GROQ_API_KEY = previousGroqKey;
        app.locals.launchClock = () => launchTime - 1;
      }
    });

    await t.test("vendor portal access is granted only to approved accounts before launch", async () => {
      assert.equal((await apiRequest("/api/vendor/access")).status, 401);
      const vendorAccess = await apiRequest("/api/vendor/access", { token: ownerVendor.token });
      assert.deepEqual(vendorAccess.body, { approvedVendor: true });
      assert.equal(vendorAccess.headers.get("cache-control"), "no-store");
      assert.equal((await apiRequest("/api/vendor/dashboard", { token: ownerVendor.token })).status, 200);
      assert.equal((await apiRequest("/api/vendor/enquiries", { token: ownerVendor.token })).status, 200);
      for (const vendor of [pendingVendor, rejectedVendor, suspendedVendor]) {
        assert.equal((await apiRequest("/api/vendor/access", { token: vendor.token })).status, 403);
        for (const path of ["/api/vendor/dashboard", "/api/vendor/import-jobs", "/api/vendor/pickup-location", "/api/vendor/enquiries"]) {
          assert.equal((await apiRequest(path, { token: vendor.token })).status, 403, `${path} must deny ${vendor.uid}`);
        }
      }
      assert.equal((await apiRequest("/api/vendor/access", { token: buyer.token })).status, 403);
      assert.equal((await apiRequest("/api/vendor/access", { token: admin.token })).status, 403);
    });

    await t.test("customer catalogue unlocks exactly at launch while commerce creation remains disabled", async () => {
      const disabledCommerceRoutes = [
        "/api/checkout/quote",
        "/api/orders",
        "/api/phonepe/orders",
        "/api/razorpay/orders",
        "/api/razorpay/verify",
        "/api/shiprocket/orders",
        "/api/orders/cancel",
        "/api/orders/cancel-items",
      ];
      const disabledAdminCommerceRequests = [
        { path: "/api/admin/refunds", method: "POST", body: {} },
        { path: "/api/admin/refunds/synthetic-refund/manual-complete", method: "PATCH", body: {} },
        { path: "/api/admin/returns", method: "PATCH", body: { status: "approved", returnId: "synthetic-return" } },
        { path: "/api/admin/orders/cod-collection", method: "POST", body: {} },
      ];
      app.locals.launchClock = () => launchTime;
      assert.equal((await apiRequest("/api/public-products?limit=1", { token: buyer.token })).status, 200);
      const exactLaunchProduct = await apiRequest(`/api/public-products/${eligibleProductId}`);
      assert.equal(exactLaunchProduct.status, 200);
      assert.equal(exactLaunchProduct.body.product.id, eligibleProductId);
      assert.equal(exactLaunchProduct.body.product.name, "Emulator clutch assembly");
      assert.equal(Object.hasOwn(exactLaunchProduct.body.product, "sellerId"), false);
      assert.equal((await apiRequest(`/api/public-products/${eligibleProductId}`, {
        token: ownerVendor.token,
      })).status, 200);
      for (const path of disabledCommerceRoutes) {
        const result = await apiRequest(path, {
          method: "POST",
          token: path === "/api/shiprocket/orders" ? admin.token : buyer.token,
          body: {},
        });
        assert.equal(result.status, 503, `${path} must remain disabled at launch`);
        assert.equal(result.body.code, "COMMERCE_UNAVAILABLE");
      }
      for (const request of disabledAdminCommerceRequests) {
        const result = await apiRequest(request.path, { ...request, token: admin.token });
        assert.equal(result.status, 503, `${request.path} must remain disabled at launch`);
        assert.equal(result.body.code, "COMMERCE_UNAVAILABLE");
      }
      assert.equal((await database.collection("orders").where("userId", "==", buyer.uid).get()).size, 0);
      assert.equal((await database.collection("refundRequests").where("requestedBy", "==", admin.uid).get()).size, 0);
      assert.equal((await database.collection("cancellationRequests").where("userId", "==", buyer.uid).get()).size, 0);

      app.locals.launchClock = () => launchTime + 1;
      const afterLaunchProduct = await apiRequest(`/api/public-products/${eligibleProductId}`);
      assert.equal(afterLaunchProduct.status, 200);
      assert.equal(afterLaunchProduct.body.product.id, eligibleProductId);
      assert.equal(Object.hasOwn(afterLaunchProduct.body.product, "sellerId"), false);
      for (const path of disabledCommerceRoutes) {
        const result = await apiRequest(path, {
          method: "POST",
          token: path === "/api/shiprocket/orders" ? admin.token : buyer.token,
          body: {},
        });
        assert.equal(result.status, 503, `${path} must remain disabled after launch`);
        assert.equal(result.body.code, "COMMERCE_UNAVAILABLE");
      }
      for (const request of disabledAdminCommerceRequests) {
        const result = await apiRequest(request.path, { ...request, token: admin.token });
        assert.equal(result.status, 503, `${request.path} must remain disabled after launch`);
        assert.equal(result.body.code, "COMMERCE_UNAVAILABLE");
      }
      assert.equal((await database.collection("orders").where("userId", "==", buyer.uid).get()).size, 0);
      assert.equal((await database.collection("refundRequests").where("requestedBy", "==", admin.uid).get()).size, 0);
      assert.equal((await database.collection("cancellationRequests").where("userId", "==", buyer.uid).get()).size, 0);
      app.locals.launchClock = () => launchTime - 1;
    });

    await t.test("admin vendor payouts remain disabled before, at, and after launch", async () => {
      const orderReference = database.collection("orders").doc();
      const settlementReference = database.collection("vendorSettlements").doc();
      const eligibleAt = new Date(Date.now() - 86400000).toISOString();
      const item = {
        productId: eligibleProductId,
        sellerType: "vendor",
        sellerId: ownerVendor.uid,
        sellerSubtotal: 1000,
        commissionAmount: 100,
        vendorPayout: 900,
        settlementId: settlementReference.id,
        settlementStatus: "payable",
      };
      createdOrderIds.push(orderReference.id);
      createdSettlementIds.push(settlementReference.id);
      await Promise.all([
        orderReference.set({
          status: "delivered",
          orderStatus: "delivered",
          paymentStatus: "Paid",
          items: [item],
        }),
        settlementReference.set({
          orderId: orderReference.id,
          vendorId: ownerVendor.uid,
          vendorPayout: 900,
          orderStatus: "delivered",
          paymentStatus: "Paid",
          settlementStatus: "payable",
          eligibleAt,
        }),
      ]);

      for (const time of [launchTime - 1, launchTime, launchTime + 1]) {
        app.locals.launchClock = () => time;
        const result = await apiRequest("/api/admin/finance/order", {
          method: "POST",
          token: admin.token,
          body: {
            action: "settle",
            orderId: orderReference.id,
            settlementId: settlementReference.id,
          },
        });
        assert.equal(result.status, 503);
        assert.equal(result.body.code, "COMMERCE_UNAVAILABLE");
        assert.equal(result.headers.get("cache-control"), "no-store");
        const [orderSnapshot, settlementSnapshot] = await Promise.all([
          orderReference.get(),
          settlementReference.get(),
        ]);
        assert.equal(orderSnapshot.data().items[0].settlementStatus, "payable");
        assert.equal(settlementSnapshot.data().settlementStatus, "payable");
        assert.equal(settlementSnapshot.data().paidAt, undefined);
      }

      app.locals.launchClock = () => launchTime - 1;
    });

    await t.test("admin order-status mutations remain disabled with no database changes", async () => {
      const orderReference = database.collection("orders").doc();
      const originalOrder = {
        status: "pending",
        orderStatus: "pending",
        paymentStatus: "Pending",
        items: [],
        timeline: [],
      };
      createdOrderIds.push(orderReference.id);
      await orderReference.set(originalOrder);

      for (const [time, requestedStatus] of [
        [launchTime - 1, "processing"],
        [launchTime, "packed"],
        [launchTime + 1, "confirmed"],
      ]) {
        app.locals.launchClock = () => time;
        const result = await apiRequest("/api/admin/orders/status", {
          method: "POST",
          token: admin.token,
          body: { orderId: orderReference.id, status: requestedStatus },
        });
        assert.equal(result.status, 503);
        assert.equal(result.body.code, "COMMERCE_UNAVAILABLE");
        const snapshot = await orderReference.get();
        assert.deepEqual(snapshot.data(), originalOrder);
      }

      app.locals.launchClock = () => launchTime - 1;
    });

    await t.test("admin return approval and reverse-pickup actions remain disabled", async () => {
      for (const time of [launchTime - 1, launchTime, launchTime + 1]) {
        app.locals.launchClock = () => time;
        for (const status of ["approved", "pickup_pending"]) {
          const returnId = randomUUID();
          const result = await apiRequest("/api/admin/returns", {
            method: "PATCH",
            token: admin.token,
            body: { returnId, status },
          });
          assert.equal(result.status, 503);
          assert.equal(result.body.code, "COMMERCE_UNAVAILABLE");
          assert.equal((await database.collection("returnRequests").doc(returnId).get()).exists, false);
        }
      }

      app.locals.launchClock = () => launchTime - 1;
    });

    await t.test("unavailable authoritative time fails closed", async () => {
      app.locals.launchClock = () => Number.NaN;
      assert.equal((await apiRequest("/api/settings/public")).status, 503);
      const blockedMessage = { message: "The PartsWalaIND marketplace is not open yet." };
      for (const request of [
        { path: "/api/public-products?category=Engine&limit=1" },
        { path: `/api/public-products/${eligibleProductId}` },
        { path: `/api/products/${eligibleProductId}/vendor-contact` },
        { path: `/api/reviews?productId=${eligibleProductId}` },
        {
          path: "/api/products/vendor-names",
          method: "POST",
          body: { productIds: [eligibleProductId] },
        },
      ]) {
        const result = await apiRequest(request.path, request);
        assert.equal(result.status, 403);
        assert.deepEqual(result.body, blockedMessage);
      }
      const unavailableAssistant = await apiRequest("/api/ai/chat", {
        method: "POST",
        body: { message: "Search for a clutch" },
      });
      assert.equal(unavailableAssistant.status, 403);
      app.locals.launchClock = () => launchTime - 1;
    });

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
      assert.equal((await apiRequest("/api/enquiries", { token: revokedBuyer.token })).status, 403);
      app.locals.launchClock = () => launchTime;
      assert.equal((await apiRequest("/api/enquiries", { token: revokedBuyer.token })).status, 200);
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await auth.revokeRefreshTokens(revokedBuyer.uid);
      assert.equal((await apiRequest("/api/enquiries", { token: revokedBuyer.token })).status, 401);
      app.locals.launchClock = () => launchTime - 1;
    });

    await t.test("vendor-name POST stays closed before launch and returns eligible products at launch", async () => {
      const closed = await apiRequest("/api/products/vendor-names", {
        method: "POST",
        body: { productIds: [eligibleProductId] },
      });
      assert.equal(closed.status, 403);
      app.locals.launchClock = () => launchTime;
      const response = await apiRequest("/api/products/vendor-names", {
        method: "POST",
        body: { productIds: [eligibleProductId, pendingProductId, conflictingProductId] },
      });
      assert.equal(response.status, 200);
      assert.equal((await apiRequest("/api/checkout/quote", {
        method: "POST",
        token: buyer.token,
        body: {},
      })).status, 503);
      assert.equal((await apiRequest("/api/orders", {
        method: "POST",
        token: buyer.token,
        body: {},
      })).status, 503);
      assert.deepEqual(response.body.eligibleProductIds, [eligibleProductId]);
      assert.equal(response.body.names[eligibleProductId], `Business ${ownerVendor.uid.slice(0, 8)}`);
      assert.equal(Object.hasOwn(response.body.names, conflictingProductId), false);
      assert.equal((await apiRequest("/api/products/vendor-names", {
        method: "POST",
        body: { productIds: ["products/invalid"] },
      })).status, 400);

      app.locals.launchClock = () => launchTime + 1;
      const afterLaunchResponse = await apiRequest("/api/products/vendor-names", {
        method: "POST",
        body: { productIds: [eligibleProductId] },
      });
      assert.equal(afterLaunchResponse.status, 200);
      assert.deepEqual(afterLaunchResponse.body.eligibleProductIds, [eligibleProductId]);
      assert.equal(afterLaunchResponse.body.names[eligibleProductId], `Business ${ownerVendor.uid.slice(0, 8)}`);
      app.locals.launchClock = () => launchTime;
    });

    await t.test("vendor contact lookup follows the exact launch boundary and exposes only explicit public contact", async () => {
      const contactPath = `/api/products/${eligibleProductId}/vendor-contact`;
      app.locals.launchClock = () => launchTime - 1;
      assert.equal((await apiRequest(contactPath)).status, 403);

      app.locals.launchClock = () => launchTime;
      const atLaunch = await apiRequest(contactPath);
      assert.equal(atLaunch.status, 200);
      assert.deepEqual(atLaunch.body, { whatsAppNumber: "919999000000" });

      app.locals.launchClock = () => launchTime + 1;
      const afterLaunch = await apiRequest(contactPath);
      assert.equal(afterLaunch.status, 200);
      assert.deepEqual(afterLaunch.body, { whatsAppNumber: "919999000000" });
      app.locals.launchClock = () => launchTime;
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
      app.locals.launchClock = () => launchTime - 1;
      assert.equal((await apiRequest("/api/enquiries", { token: buyer.token })).status, 403);
      assert.equal((await apiRequest("/api/vendor/enquiries", { token: ownerVendor.token })).status, 200);
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
      app.locals.launchClock = () => launchTime;
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
    try {
      await cleanup();
    } finally {
      if (previousLaunchClock === undefined) delete app.locals.launchClock;
      else app.locals.launchClock = previousLaunchClock;
    }
  }
});
