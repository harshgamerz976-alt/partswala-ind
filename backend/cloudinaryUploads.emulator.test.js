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
const password = "LocalEmulatorPass123!";
const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

async function emulatorRequest(host, path, options = {}) {
  const response = await fetch(`http://${host}${path}`, options);
  const body = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `Firebase emulator request failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

test("Cloudinary upload routes enforce authenticated server-side validation and ownership", {
  skip: !emulatorConfigured && "Run with isolated demo-project Firebase Auth and Firestore emulators.",
}, async () => {
  assert.ok(projectId.startsWith("demo-"), "This test must only use a local demo project.");
  assert.ok(isLoopbackHost(firestoreHost) && isLoopbackHost(authHost), "This test must only use local emulators.");

  const environmentNames = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "CLOUDINARY_CLOUD_NAME",
    "CLOUDINARY_API_KEY",
    "CLOUDINARY_API_SECRET",
  ];
  const previousEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));
  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
  process.env.FIREBASE_CLIENT_EMAIL = "media-upload-test@example.test";
  process.env.CLOUDINARY_CLOUD_NAME = "emulator-test-cloud";
  process.env.CLOUDINARY_API_KEY = "emulator-test-key";
  process.env.CLOUDINARY_API_SECRET = "emulator-test-secret";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.FIREBASE_PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const { cert, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore } = await import("firebase-admin/firestore");
  const firebaseApp = initializeApp({
    credential: cert({
      projectId,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY,
    }),
    projectId,
  }, `media-upload-${randomUUID()}`);
  const auth = getAuth(firebaseApp);
  const database = getFirestore(firebaseApp);
  const { default: app } = await import("./server.js");
  const originalFetch = globalThis.fetch;
  const createdUsers = [];
  const createdProducts = [];
  let cloudinaryRequests = 0;
  let failCloudinary = false;
  globalThis.fetch = async (input, options) => {
    if (String(input).startsWith("https://api.cloudinary.com/")) {
      cloudinaryRequests += 1;
      if (failCloudinary) {
        return { ok: false, status: 413, async json() { return { error: { message: "provider detail" } }; } };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return { secure_url: "https://res.cloudinary.com/emulator-test-cloud/image/upload/v1/test.jpg" };
        },
      };
    }
    return originalFetch(input, options);
  };

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const api = `http://127.0.0.1:${server.address().port}`;

  async function createAccount(role, vendorStatus = "") {
    const email = `${role}-${randomUUID()}@example.test`;
    const account = await emulatorRequest(
      authHost,
      "/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-emulator-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    createdUsers.push(account.localId);
    await database.collection("users").doc(account.localId).set({
      role,
      ...(role === "vendor" ? { vendorStatus } : {}),
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
        body: JSON.stringify({ email: account.email, password, returnSecureToken: true }),
      },
    );
    return { ...account, token: signedIn.idToken };
  }

  async function upload(path, token, { purpose = "profile", fileName = "part.jpg", mimeType = "image/jpeg", bytes = jpegBytes, productId } = {}) {
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: mimeType }), fileName);
    if (purpose) body.append("purpose", purpose);
    if (productId) body.append("productId", productId);
    const response = await originalFetch(`${api}${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => ({})) };
  }

  try {
    const customer = await createAccount("customer");
    const secondCustomer = await createAccount("customer");
    const approvedVendor = await createAccount("vendor", "approved");
    const otherVendor = await createAccount("vendor", "approved");
    const pendingVendor = await createAccount("vendor", "pending");
    const admin = await createAdmin();
    const ownProduct = await database.collection("products").add({
      sellerId: approvedVendor.uid,
      sellerType: "vendor",
      status: "pending",
      enabled: false,
    });
    const foreignProduct = await database.collection("products").add({
      sellerId: otherVendor.uid,
      sellerType: "vendor",
      status: "pending",
      enabled: false,
    });
    createdProducts.push(ownProduct.id, foreignProduct.id);

    const unauthenticated = await upload("/api/uploads/cloudinary", undefined);
    assert.equal(unauthenticated.status, 401);

    const profileUpload = await upload("/api/uploads/cloudinary", customer.token);
    assert.equal(profileUpload.status, 201);
    assert.equal(profileUpload.body.imageUrl, "https://res.cloudinary.com/emulator-test-cloud/image/upload/v1/test.jpg");
    assert.equal(profileUpload.headers.get("cache-control"), "no-store");

    const mismatchedFile = await upload("/api/uploads/cloudinary", customer.token, { fileName: "part.png" });
    assert.equal(mismatchedFile.status, 400);
    assert.equal(cloudinaryRequests, 1, "invalid image content must not reach Cloudinary");

    const invalidSignature = await upload("/api/uploads/cloudinary", customer.token, {
      bytes: Buffer.from("not a jpeg"),
    });
    assert.equal(invalidSignature.status, 400);
    assert.equal(cloudinaryRequests, 1, "invalid file signatures must not reach Cloudinary");

    const oversizedFile = Buffer.alloc(8 * 1024 * 1024 + 1);
    oversizedFile.set(jpegBytes);
    const oversized = await upload("/api/uploads/cloudinary", customer.token, { bytes: oversizedFile });
    assert.equal(oversized.status, 413);
    assert.equal(cloudinaryRequests, 1, "oversized images must not reach Cloudinary");

    const customerProductUpload = await upload("/api/uploads/cloudinary", customer.token, { purpose: "product" });
    assert.equal(customerProductUpload.status, 403);
    assert.equal(cloudinaryRequests, 1);

    const adminProductUpload = await upload("/api/uploads/cloudinary", admin.token, { purpose: "product" });
    assert.equal(adminProductUpload.status, 201);
    assert.equal(cloudinaryRequests, 2);

    const directSignature = await originalFetch(`${api}/api/uploads/cloudinary/signature`, { method: "POST" });
    assert.equal(directSignature.status, 410, "legacy signature route must not issue bypassable signatures");

    const pendingVendorUpload = await upload("/api/vendor/product-images", pendingVendor.token);
    assert.equal(pendingVendorUpload.status, 403);
    const foreignProductUpload = await upload("/api/vendor/product-images", approvedVendor.token, { productId: foreignProduct.id });
    assert.equal(foreignProductUpload.status, 403);
    assert.equal(cloudinaryRequests, 2, "unauthorized vendor uploads must not reach Cloudinary");

    const ownProductUpload = await upload("/api/vendor/product-images", approvedVendor.token, { productId: ownProduct.id });
    assert.equal(ownProductUpload.status, 201);
    assert.equal(cloudinaryRequests, 3);

    failCloudinary = true;
    const providerFailure = await upload("/api/uploads/cloudinary", secondCustomer.token);
    assert.equal(providerFailure.status, 502);
    assert.doesNotMatch(JSON.stringify(providerFailure.body), /provider detail/);

    const rateLimitCustomer = await createAccount("customer");
    for (let index = 0; index < 20; index += 1) {
      const request = new FormData();
      const response = await originalFetch(`${api}/api/uploads/cloudinary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${rateLimitCustomer.token}` },
        body: request,
      });
      assert.equal(response.status, 400);
      await response.json();
    }
    const rateLimited = await originalFetch(`${api}/api/uploads/cloudinary`, {
      method: "POST",
      headers: { Authorization: `Bearer ${rateLimitCustomer.token}` },
      body: new FormData(),
    });
    assert.equal(rateLimited.status, 429);
    await rateLimited.json();
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    try {
      await Promise.all(createdProducts.map((id) => database.collection("products").doc(id).delete()));
      for (const uid of createdUsers) {
        await database.collection("users").doc(uid).delete();
        await auth.deleteUser(uid);
      }
      await firebaseApp.delete();
    } finally {
      for (const [name, value] of previousEnvironment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  }
});
