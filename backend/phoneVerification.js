// backend/phoneVerification.js
// Server-owned phone verification.
//
// The verified-phone state lives in Firestore on users/{uid} and is written ONLY by the
// backend Admin SDK after Firebase Phone Auth proves ownership of the number (the verified
// ID token carries the `phone_number` claim). The browser can never set phoneVerified.

import { formatIndianPhoneForFirebase, normalizeIndianPhoneNumber } from "../shared/phoneNumber.js";

export const PHONE_VERIFICATION_FIELDS = ["phoneVerified", "verifiedPhone", "phoneVerifiedAt", "phoneVerificationMethod"];

/** Normalizes an Indian mobile number to its 10 significant digits, or "" when it is not a usable number. */
export function normalizePhoneNumber(value) {
  return normalizeIndianPhoneNumber(value);
}

/** Presents a normalized 10-digit number the same way the rest of the app stores it. */
export function formatPhoneNumber(value) {
  return formatIndianPhoneForFirebase(value);
}

/**
 * Returns null when the order/quote phone is proven to belong to the signed-in user,
 * otherwise a { code, message } pair describing exactly what is missing.
 */
export function phoneVerificationProblem(profile, customerPhone, tokenPhoneNumber) {
  const customer = normalizePhoneNumber(customerPhone);
  if (!customer) {
    return { code: "INVALID_PHONE", message: "Enter a valid 10-digit mobile number for delivery." };
  }
  if (profile?.phoneVerified !== true) {
    return { code: "PHONE_NOT_VERIFIED", message: "Verify your mobile number before placing an order. Open your profile or use the verification code on checkout." };
  }
  const tokenPhone = normalizePhoneNumber(tokenPhoneNumber);
  if (!tokenPhone) {
    return { code: "PHONE_AUTH_REQUIRED", message: "Confirm this number with Firebase Phone Auth before placing an order." };
  }
  const verified = normalizePhoneNumber(profile?.verifiedPhone);
  if (!verified) {
    return { code: "PHONE_VERIFICATION_INCOMPLETE", message: "Your mobile verification is incomplete. Verify your number again to continue." };
  }
  if (verified !== customer) {
    return { code: "PHONE_MISMATCH", message: "Your verified mobile number does not match the delivery phone number. Verify the delivery number to continue." };
  }
  if (tokenPhone !== verified) {
    return { code: "PHONE_VERIFIER_MISMATCH", message: "Your current Firebase account phone does not match the saved verified phone. Verify the number again to continue." };
  }
  const stored = normalizePhoneNumber(profile?.phone);
  if (stored && stored !== verified) {
    return { code: "PHONE_CHANGED", message: "Your saved mobile number changed after verification. Verify your number again to continue." };
  }
  return null;
}

/** Throws an error carrying a stable `code` so API routes can map it to a clear response. */
export function assertVerifiedCustomerPhone({ profile, customerPhone, tokenPhoneNumber }) {
  const problem = phoneVerificationProblem(profile, customerPhone, tokenPhoneNumber);
  if (problem) {
    const error = new Error(problem.message);
    error.code = problem.code;
    throw error;
  }
  return true;
}

/**
 * Decides whether a Firebase ID token proves ownership of the claimed phone number and,
 * when it does, returns the server-owned profile fields (never trusted from the client).
 */
export function verifiedPhoneUpdate({ tokenPhoneNumber, claimedPhone, timestamp = new Date().toISOString() }) {
  const tokenPhone = normalizePhoneNumber(tokenPhoneNumber);
  const claimed = normalizePhoneNumber(claimedPhone);
  if (!tokenPhone) {
    return { status: 400, code: "PHONE_AUTH_REQUIRED", message: "Confirm this number with the phone verification code before saving it." };
  }
  if (!claimed) {
    return { status: 400, code: "INVALID_PHONE", message: "Enter a valid 10-digit mobile number to verify." };
  }
  if (tokenPhone !== claimed) {
    return { status: 403, code: "PHONE_VERIFIER_MISMATCH", message: "That verification code belongs to a different phone number. Request a code for this number and try again." };
  }
  const storedPhone = formatPhoneNumber(claimed);
  return {
    update: {
      phone: storedPhone,
      phoneVerified: true,
      verifiedPhone: storedPhone,
      phoneVerifiedAt: timestamp,
      phoneVerificationMethod: "firebase_phone_auth",
    },
  };
}
