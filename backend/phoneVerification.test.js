import test from "node:test";
import assert from "node:assert/strict";
import { assertVerifiedCustomerPhone, formatPhoneNumber, normalizePhoneNumber, phoneVerificationProblem, verifiedPhoneUpdate } from "./phoneVerification.js";

const verifiedProfile = { phone: "+919876543210", phoneVerified: true, verifiedPhone: "+919876543210" };

test("verified matching phone succeeds for order creation and quotes", () => {
  const qaProfile = { phone: "+918770065676", phoneVerified: true, verifiedPhone: "+918770065676" };
  assert.equal(phoneVerificationProblem(qaProfile, "+91 8770065676", "+918770065676"), null);
  assert.equal(phoneVerificationProblem(verifiedProfile, "+91 98765 43210", "+919876543210"), null);
  assert.equal(phoneVerificationProblem(verifiedProfile, "9876543210", "9876543210"), null);
  assert.equal(phoneVerificationProblem(verifiedProfile, "919876543210", "+919876543210"), null);
  assert.equal(assertVerifiedCustomerPhone({ profile: verifiedProfile, customerPhone: "09876543210", tokenPhoneNumber: "+919876543210" }), true);
});

test("verified mismatching phone fails", () => {
  const problem = phoneVerificationProblem(verifiedProfile, "+919812345678", "+919876543210");
  assert.equal(problem.code, "PHONE_MISMATCH");
  assert.throws(() => assertVerifiedCustomerPhone({ profile: verifiedProfile, customerPhone: "9812345678", tokenPhoneNumber: "+919876543210" }), /does not match/);
});

test("backend rejects unverified and mismatched delivery phones even if the UI has stale state", () => {
  assert.throws(() => assertVerifiedCustomerPhone({
    profile: { phone: "+918770065676", phoneVerified: false },
    customerPhone: "+91 8770065676",
    tokenPhoneNumber: "+918770065676",
  }), (error) => error.code === "PHONE_NOT_VERIFIED");
  assert.throws(() => assertVerifiedCustomerPhone({
    profile: { phone: "+918770065676", phoneVerified: true, verifiedPhone: "+918770065676" },
    customerPhone: "+91 98765 43210",
    tokenPhoneNumber: "+918770065676",
  }), (error) => error.code === "PHONE_MISMATCH");
});

test("unverified or incomplete phone state fails", () => {
  assert.equal(phoneVerificationProblem({ phone: "+919876543210", phoneVerified: false }, "+919876543210", "+919876543210").code, "PHONE_NOT_VERIFIED");
  assert.equal(phoneVerificationProblem({ phone: "+919876543210", phoneVerified: "true" }, "+919876543210", "+919876543210").code, "PHONE_NOT_VERIFIED");
  assert.equal(phoneVerificationProblem(null, "+919876543210", "+919876543210").code, "PHONE_NOT_VERIFIED");
  assert.equal(phoneVerificationProblem({ phone: "+919876543210", phoneVerified: true }, "+919876543210", "+919876543210").code, "PHONE_VERIFICATION_INCOMPLETE");
  assert.equal(phoneVerificationProblem(verifiedProfile, "", "+919876543210").code, "INVALID_PHONE");
});

test("changing the saved phone number after verification requires re-verification", () => {
  const problem = phoneVerificationProblem({ ...verifiedProfile, phone: "+919812345678" }, "+919876543210", "+919876543210");
  assert.equal(problem.code, "PHONE_CHANGED");
});

test("checkout requires the current Firebase token phone to match the verified profile", () => {
  assert.equal(phoneVerificationProblem(verifiedProfile, "+919876543210", undefined).code, "PHONE_AUTH_REQUIRED");
  assert.equal(phoneVerificationProblem(verifiedProfile, "+919876543210", "+919812345678").code, "PHONE_VERIFIER_MISMATCH");
});

test("phone normalization is strict enough to fail closed", () => {
  assert.equal(normalizePhoneNumber("8770065676"), "8770065676");
  assert.equal(normalizePhoneNumber("+918770065676"), "8770065676");
  assert.equal(normalizePhoneNumber("+91 98765 43210"), "9876543210");
  assert.equal(normalizePhoneNumber("+91 87700 65676"), "8770065676");
  assert.equal(normalizePhoneNumber("+91-87700-65676"), "8770065676");
  assert.equal(normalizePhoneNumber("09876543210"), "9876543210");
  assert.equal(normalizePhoneNumber("877006567"), "");
  assert.equal(normalizePhoneNumber("+91 87700 6567x"), "");
  assert.equal(normalizePhoneNumber("+1 8770065676"), "");
  assert.equal(normalizePhoneNumber("98765"), "");
  assert.equal(normalizePhoneNumber(""), "");
  assert.equal(normalizePhoneNumber(null), "");
  assert.equal(formatPhoneNumber("9876543210"), "+919876543210");
});

test("only a Firebase-verified token for the same number can persist verification", () => {
  const accepted = verifiedPhoneUpdate({ tokenPhoneNumber: "+919876543210", claimedPhone: "9876543210", timestamp: "2026-09-29T00:00:00.000Z" });
  assert.equal(accepted.update.phoneVerified, true);
  assert.equal(accepted.update.verifiedPhone, "+919876543210");
  assert.equal(accepted.update.phoneVerificationMethod, "firebase_phone_auth");
  assert.equal(accepted.update.phoneVerifiedAt, "2026-09-29T00:00:00.000Z");

  assert.equal(verifiedPhoneUpdate({ tokenPhoneNumber: undefined, claimedPhone: "9876543210" }).code, "PHONE_AUTH_REQUIRED");
  assert.equal(verifiedPhoneUpdate({ tokenPhoneNumber: "+919812345678", claimedPhone: "9876543210" }).code, "PHONE_VERIFIER_MISMATCH");
  assert.equal(verifiedPhoneUpdate({ tokenPhoneNumber: "+919876543210", claimedPhone: "123" }).code, "INVALID_PHONE");
  assert.equal(verifiedPhoneUpdate({ tokenPhoneNumber: "+919876543210", claimedPhone: "9876543210" }).update.phoneVerified, true);
});
