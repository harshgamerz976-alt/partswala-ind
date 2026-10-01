import test from "node:test";
import assert from "node:assert/strict";
import { redactAuditValue } from "./audit.js";

test("audit redaction removes credentials, verification codes, and financial identifiers recursively", () => {
  assert.deepEqual(redactAuditValue({
    action: "vendor_updated",
    otp: "123456",
    profile: { phone: "+911234567890", gstin: "GST-PRIVATE", pan: "PAN-PRIVATE", bankAccountNumber: "1234", ifsc: "IFSC-PRIVATE", city: "Pune" },
    changes: [{ apiKey: "secret", status: "approved" }],
  }), {
    action: "vendor_updated",
    profile: { city: "Pune" },
    changes: [{ status: "approved" }],
  });
});

test("audit free-text reasons redact financial identifiers and contact details", () => {
  const reason = redactAuditValue("OTP 123456, account 123456789012, IFSC HDFC0001234, GSTIN 22AAAAA0000A1Z5, PAN ABCDE1234F, call +91 9876543210, email buyer@example.com");
  assert.doesNotMatch(reason, /123456|123456789012|HDFC0001234|22AAAAA0000A1Z5|ABCDE1234F|9876543210|buyer@example\.com/);
  assert.equal((reason.match(/\[REDACTED\]/g) || []).length, 7);
});