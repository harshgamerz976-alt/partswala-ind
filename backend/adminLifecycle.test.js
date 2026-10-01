import test from "node:test";
import assert from "node:assert/strict";
import { adminLifecycleOverrideProblem } from "./adminLifecycle.js";

test("admin status changes cannot bypass delivery evidence or settlement workflows", () => {
  assert.equal(adminLifecycleOverrideProblem("delivered").code, "DELIVERY_EVIDENCE_REQUIRED");
  assert.equal(adminLifecycleOverrideProblem("settled").code, "SETTLEMENT_WORKFLOW_REQUIRED");
  assert.equal(adminLifecycleOverrideProblem("completed").code, "DELIVERY_EVIDENCE_REQUIRED");
  assert.equal(adminLifecycleOverrideProblem("in_transit").code, "SHIPPING_EVIDENCE_REQUIRED");
  assert.equal(adminLifecycleOverrideProblem("return_approved").code, "RETURN_WORKFLOW_REQUIRED");
  assert.equal(adminLifecycleOverrideProblem("refunded").code, "REFUND_WORKFLOW_REQUIRED");
  assert.equal(adminLifecycleOverrideProblem("processing"), null);
});