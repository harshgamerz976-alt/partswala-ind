import { normalizeIndianPhoneNumber } from "../../shared/phoneNumber.js";

export function deliveryPhoneVerificationState(profile, deliveryPhone) {
  const delivery = normalizeIndianPhoneNumber(deliveryPhone);
  if (!delivery) return "invalid_delivery_phone";
  if (profile?.phoneVerified !== true) return "unverified";

  const verified = normalizeIndianPhoneNumber(profile.verifiedPhone);
  if (!verified) return "incomplete";
  return verified === delivery ? "verified" : "mismatch";
}
