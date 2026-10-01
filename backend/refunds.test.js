import assert from "node:assert/strict";
import test from "node:test";
import { createProviderRefund, normalizeProviderRefundStatus, refundIdempotencyKey } from "./refunds.js";

test("Razorpay refund adapter sends paise and a stable idempotency key", async () => {
  let call;
  const result = await createProviderRefund({
    provider: "razorpay",
    paymentId: "pay-1",
    refundRequestId: "refund-request-1",
    amount: 123.45,
    env: { RAZORPAY_KEY_ID: "key", RAZORPAY_KEY_SECRET: "secret" },
    fetchImpl: async (url, options) => {
      call = { url, options };
      return { ok: true, json: async () => ({ id: "rfnd-1", status: "pending" }) };
    },
  });
  assert.equal(call.url, "https://api.razorpay.com/v1/payments/pay-1/refund");
  assert.equal(JSON.parse(call.options.body).amount, 12345);
  assert.equal(call.options.headers["X-Razorpay-Idempotency-Key"], refundIdempotencyKey("refund-request-1"));
  assert.equal(result.status, "provider_refund_created");
});

test("refund adapters do not report success when configuration or provider response is missing", async () => {
  await assert.rejects(createProviderRefund({ provider: "phonepe", paymentId: "pay", refundRequestId: "refund-1234", amount: 10, env: {} }), /not configured/);
  await assert.rejects(createProviderRefund({
    provider: "razorpay",
    paymentId: "pay",
    refundRequestId: "refund-1234",
    amount: 10,
    env: { RAZORPAY_KEY_ID: "key", RAZORPAY_KEY_SECRET: "secret" },
    fetchImpl: async () => ({ ok: true, json: async () => ({ status: "processed" }) }),
  }), /did not return a refund reference/);
});

test("provider refund states only complete from explicit provider confirmation", () => {
  assert.equal(normalizeProviderRefundStatus("pending"), "provider_refund_created");
  assert.equal(normalizeProviderRefundStatus("processed"), "refund_completed");
  assert.equal(normalizeProviderRefundStatus("failed"), "refund_failed");
});