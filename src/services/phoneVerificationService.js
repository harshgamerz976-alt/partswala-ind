import { auth } from "../firebase";
import { formatIndianPhoneForFirebase } from "../../shared/phoneNumber.js";

/**
 * Phone verification is owned by the backend. The browser only asks the backend to confirm the
 * number that Firebase Phone Auth already verified, and the backend writes the verified state
 * (users/{uid}.phoneVerified + verifiedPhone) that the order APIs require.
 */

export const PHONE_VERIFICATION_FIELDS = ["phoneVerified", "verifiedPhone", "phoneVerifiedAt", "phoneVerificationMethod"];

const BASE_URL = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787").replace(/\/$/, "");

/** Removes server-owned fields so a local profile save can never spoof phone verification. */
export function stripProtectedProfileFields(data = {}) {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !PHONE_VERIFICATION_FIELDS.includes(key)));
}

export async function registerVerifiedPhone(phone) {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before verifying a mobile number.");
  const expectedPhone = formatIndianPhoneForFirebase(phone);
  if (!expectedPhone) throw new Error("Enter a valid 10-digit Indian mobile number.");
  await user.reload();
  // A refreshed ID token carries the `phone_number` claim that Firebase Phone Auth just confirmed.
  const token = await user.getIdToken(true);
  const tokenPhone = formatIndianPhoneForFirebase((await user.getIdTokenResult()).claims.phone_number);
  if (tokenPhone !== expectedPhone) throw new Error("Firebase has not refreshed the verified phone number yet. Please try again.");
  const response = await fetch(`${BASE_URL}/api/phone/verification`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ phone: expectedPhone }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "Your mobile verification could not be saved.");
  return result;
}
