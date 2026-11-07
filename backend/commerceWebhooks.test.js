import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { CUSTOMER_COMMERCE_ENABLED } from "../shared/commerceAvailability.js";
import app from "./server.js";

test("signed payment and shipping webhooks are side-effect-free while commerce is disabled", async () => {
  assert.equal(CUSTOMER_COMMERCE_ENABLED, false);
  const environmentNames = [
    "PHONEPE_WEBHOOK_SECRET",
    "RAZORPAY_WEBHOOK_SECRET",
    "SHIPROCKET_WEBHOOK_SECRET",
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
  ];
  const previousEnvironment = new Map(environmentNames.map((name) => [name, process.env[name]]));
  process.env.PHONEPE_WEBHOOK_SECRET = "test-phonepe-webhook-secret";
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-razorpay-webhook-secret";
  process.env.SHIPROCKET_WEBHOOK_SECRET = "test-shiprocket-webhook-secret";
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_CLIENT_EMAIL;
  delete process.env.FIREBASE_PRIVATE_KEY;

  const previousLaunchClock = app.locals.launchClock;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function send(path, payload, headers) {
    const body = JSON.stringify(payload);
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body,
    });
    return { response, body: await response.json() };
  }

  try {
    const launchTime = Date.parse("2026-11-07T18:30:00.000Z");
    for (const now of [launchTime - 1, launchTime, launchTime + 1]) {
      app.locals.launchClock = () => now;
      const phonePe = await send("/api/phonepe/webhook", {
        orderId: "synthetic-existing-order",
        status: "paid",
        transactionId: "synthetic-transaction",
      }, { "x-api-key": process.env.PHONEPE_WEBHOOK_SECRET });
      const phonePeRefund = await send("/api/phonepe/webhook", {
        refundRequestId: "synthetic-existing-refund",
        refundStatus: "completed",
        eventType: "refund.completed",
      }, { "x-api-key": process.env.PHONEPE_WEBHOOK_SECRET });

      const razorpayPayload = {
        event: "payment.captured",
        payload: { payment: { entity: { order_id: "synthetic-provider-order", id: "synthetic-payment" } } },
      };
      const razorpayBody = JSON.stringify(razorpayPayload);
      const razorpaySignature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(razorpayBody).digest("hex");
      const razorpay = await send("/api/razorpay/webhook", razorpayPayload, {
        "x-razorpay-signature": razorpaySignature,
        "x-razorpay-event-id": "synthetic-razorpay-event",
      });

      const shiprocketPayload = { order_id: "synthetic-existing-order", current_status: "Delivered" };
      const shiprocket = await send("/api/shiprocket/webhook", shiprocketPayload, {
        "x-api-key": process.env.SHIPROCKET_WEBHOOK_SECRET,
      });
      const logisticsAlias = await send("/api/logistics/webhook", shiprocketPayload, {
        "x-api-key": process.env.SHIPROCKET_WEBHOOK_SECRET,
      });

      for (const result of [phonePe, phonePeRefund, razorpay, shiprocket, logisticsAlias]) {
        assert.equal(result.response.status, 503);
        assert.equal(result.response.headers.get("cache-control"), "no-store");
        assert.equal(result.body.code, "COMMERCE_UNAVAILABLE");
      }
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previousLaunchClock === undefined) delete app.locals.launchClock;
    else app.locals.launchClock = previousLaunchClock;
    for (const [name, value] of previousEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
