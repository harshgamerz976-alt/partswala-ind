import { createHash } from "node:crypto";

function requiredEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Refund provider is not configured: ${missing.join(", ")}`);
}

export function refundIdempotencyKey(refundRequestId) {
  return createHash("sha256").update(String(refundRequestId)).digest("hex");
}

export async function createProviderRefund({ provider, paymentId, refundRequestId, amount, env = process.env, fetchImpl = fetch }) {
  const amountPaise = Math.round(Number(amount) * 100);
  if (!paymentId || !refundRequestId || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) throw new Error("A valid payment, refund request, and positive refund amount are required.");
  const idempotencyKey = refundIdempotencyKey(refundRequestId);
  let url;
  let headers;
  let body;

  if (provider === "razorpay") {
    requiredEnv(env, ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    url = `https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/refund`;
    headers = {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
      "X-Razorpay-Idempotency-Key": idempotencyKey,
    };
    body = { amount: amountPaise, receipt: refundRequestId, notes: { refundRequestId } };
  } else if (provider === "phonepe") {
    requiredEnv(env, ["PHONEPE_REFUND_ENDPOINT", "PHONEPE_REFUND_AUTH_TOKEN"]);
    url = env.PHONEPE_REFUND_ENDPOINT;
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.PHONEPE_REFUND_AUTH_TOKEN}`,
      "Idempotency-Key": idempotencyKey,
    };
    body = { paymentId, merchantRefundId: refundRequestId, amount: amountPaise };
  } else {
    throw new Error("This payment provider does not support automated refunds.");
  }

  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.description || result.message || `Refund provider returned ${response.status}.`);
  const providerRefundId = String(result.id || result.refundId || result.refund_id || "");
  if (!providerRefundId) throw new Error("Refund provider did not return a refund reference.");
  return { providerRefundId, providerStatus: String(result.status || result.state || "pending"), status: "provider_refund_created" };
}

export function normalizeProviderRefundStatus(value) {
  const status = String(value || "").toLowerCase();
  if (["processed", "completed", "success", "succeeded"].includes(status)) return "refund_completed";
  if (["failed", "failure", "rejected", "cancelled", "canceled"].includes(status)) return "refund_failed";
  return "provider_refund_created";
}