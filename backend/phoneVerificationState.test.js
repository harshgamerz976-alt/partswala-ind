import assert from "node:assert/strict";
import test from "node:test";
import { deliveryPhoneVerificationState } from "../src/services/phoneVerificationState.js";
import { verifiedPhoneUpdate } from "./phoneVerification.js";

test("checkout switches to verified immediately after its stale profile is refreshed", () => {
  const staleAuthContextProfile = { phone: "+918770065676", phoneVerified: false };
  assert.equal(deliveryPhoneVerificationState(staleAuthContextProfile, "+91 8770065676"), "unverified");

  const { update: authoritativeProfile } = verifiedPhoneUpdate({
    tokenPhoneNumber: "+918770065676",
    claimedPhone: "+91 87700 65676",
    timestamp: "2026-09-29T00:00:00.000Z",
  });
  assert.equal(deliveryPhoneVerificationState(authoritativeProfile, "+91 8770065676"), "verified");
});

test("checkout clearly distinguishes a verified phone mismatch", () => {
  const profile = { phoneVerified: true, verifiedPhone: "+918770065676" };
  assert.equal(deliveryPhoneVerificationState(profile, "8770065676"), "verified");
  assert.equal(deliveryPhoneVerificationState(profile, "+91 98765 43210"), "mismatch");
});
