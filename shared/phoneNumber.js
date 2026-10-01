/** Normalize a supported Indian mobile representation to its ten national digits. */
export function normalizeIndianPhoneNumber(value) {
  const input = String(value ?? "").trim();
  if (!input || !/^\+?[0-9][0-9 -]*$/.test(input)) return "";

  let digits = input.replace(/[ -]/g, "");
  if (digits.startsWith("+")) {
    if (!digits.startsWith("+91")) return "";
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  return /^[6-9][0-9]{9}$/.test(digits) ? digits : "";
}

/** Return the E.164 representation expected by Firebase Phone Auth. */
export function formatIndianPhoneForFirebase(value) {
  const digits = normalizeIndianPhoneNumber(value);
  return digits ? `+91${digits}` : "";
}

/** Display valid numbers with a readable country code; leave invalid input intact for correction. */
export function formatIndianPhoneForDisplay(value) {
  const firebaseNumber = formatIndianPhoneForFirebase(value);
  return firebaseNumber ? `+91 ${firebaseNumber.slice(3)}` : String(value ?? "");
}
