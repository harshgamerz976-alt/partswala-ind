import test from "node:test";
import assert from "node:assert/strict";
import { firebaseIdTokenDiagnostics, shouldCheckTokenRevocation, verifyFirebaseIdToken } from "./authentication.js";

test("financial, administrative, account, and personal-data routes check revocation", () => {
  for (const path of [
    "/api/admin/orders/status",
    "/api/checkout/quote",
    "/api/orders",
    "/api/razorpay/verify",
    "/api/phonepe/orders",
    "/api/shiprocket/orders",
    "/api/vendor/finance",
    "/api/enquiries",
    "/api/vendor/enquiries",
    "/api/vendor/enquiries/enquiry-1/quote",
    "/api/phone/verification",
    "/api/ai/chat",
  ]) assert.equal(shouldCheckTokenRevocation(path), true, path);
  assert.equal(shouldCheckTokenRevocation("/api/uploads/cloudinary/signature"), false);
});

test("token verification forwards the sensitive-route revocation policy to Firebase Auth", async () => {
  const calls = [];
  const auth = { verifyIdToken: async (...args) => { calls.push(args); return { uid: "user-1" }; } };
  await verifyFirebaseIdToken(auth, "signed-token", "/api/admin/finance");
  await verifyFirebaseIdToken(auth, "signed-token", "/api/catalog");
  assert.deepEqual(calls, [["signed-token", true], ["signed-token", false]]);
});

test("Firebase token diagnostics expose safe metadata without returning token contents", () => {
  const payload = Buffer.from(JSON.stringify({
    iss: "https://securetoken.google.com/partswalaflutter",
    aud: "partswalaflutter",
    sub: "private-uid-marker",
    exp: 2000,
    privateClaim: "private-token-marker",
  })).toString("base64url");
  const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "key-id-marker" })).toString("base64url");
  const token = `${header}.${payload}.signature-marker`;
  const diagnostics = firebaseIdTokenDiagnostics(`Bearer ${token}`, 1000_000);
  assert.deepEqual(diagnostics, {
    authorizationScheme: "Bearer",
    jwtSegmentCount: 3,
    algorithm: "RS256",
    keyIdPresent: true,
    issuer: "https://securetoken.google.com/partswalaflutter",
    audience: "partswalaflutter",
    subjectPresent: true,
    expirationPresent: true,
    expired: false,
  });
  const serialized = JSON.stringify(diagnostics);
  for (const privateValue of [token, "private-uid-marker", "private-token-marker", "key-id-marker", "signature-marker"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});
