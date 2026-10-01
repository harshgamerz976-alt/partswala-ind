const SENSITIVE_AUDIT_KEY = /(secret|password|token|credential|private.?key|api.?key|otp|one.?time.?password|bank.?account|account.?number|ifsc|gstin|pan|phone|mobile|email)/i;
const SENSITIVE_AUDIT_VALUE = /(?:\b(?:otp|one[ -]?time password)\s*(?:is|[:=])?\s*\d{4,8}\b|\b\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z0-9]\b|\b[A-Z]{5}\d{4}[A-Z]\b|\b[A-Z]{4}0[A-Z0-9]{6}\b|\b[\w.+-]+@[\w.-]+\.[A-Z]{2,}\b|(?:\+\d{1,3}[ -]?)?\d[\d -]{8,16}\d)/gi;

export function redactAuditValue(value) {
  if (typeof value === "string") return value.replace(SENSITIVE_AUDIT_VALUE, "[REDACTED]");
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_AUDIT_KEY.test(key))
      .map(([key, entry]) => [key, redactAuditValue(entry)]),
  );
}