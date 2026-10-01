import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { canTransitionLifecycle, deriveShipmentOrderStatus, mapShiprocketStatus, normalizeLifecycleStatus, planCodCollection, planInventoryReservation, planInventoryRestock, validateCodCollection, verifyWebhookSignature, webhookEventId } from "./lifecycle.js";

test("webhook event IDs are stable for duplicate delivery", () => {
  const payload = { order_id: "order-1", shipment_id: "ship-1", status: "Delivered", current_timestamp: "2026-09-27T10:00:00Z" };
  assert.equal(webhookEventId("shiprocket", "event-1", payload), webhookEventId("shiprocket", "event-1", payload));
  assert.notEqual(webhookEventId("shiprocket", "event-1", payload), webhookEventId("shiprocket", "event-2", payload));
});

test("payment failure is a valid terminal payment state for a pending order", () => {
  assert.equal(normalizeLifecycleStatus("Payment Failed"), "payment_failed");
  assert.equal(canTransitionLifecycle("pending", "payment_failed"), true);
  assert.equal(canTransitionLifecycle("delivered", "payment_failed"), false);
});

test("Shiprocket RTO maps to held logistics state", () => {
  assert.deepEqual(mapShiprocketStatus("RTO Initiated"), { status: "rto", event: "rto_initiated" });
  assert.deepEqual(mapShiprocketStatus("RTO Delivered"), { status: "rto_completed", event: "rto_completed" });
  assert.deepEqual(mapShiprocketStatus("Undelivered"), { status: "in_transit", event: "delivery_failed" });
  assert.equal(mapShiprocketStatus("Delivery attempt made but not completed"), null);
  assert.deepEqual(mapShiprocketStatus("Delivered to consignee"), { status: "delivered", event: "delivered" });
  assert.equal(canTransitionLifecycle("in_transit", "rto"), true);
  assert.equal(canTransitionLifecycle("rto", "rto_completed"), true);
  assert.equal(canTransitionLifecycle("rto", "refunded"), true);
});

test("shipment failure can be retried after a failed state", () => {
  assert.equal(canTransitionLifecycle("pending", "confirmed"), true);
  assert.equal(canTransitionLifecycle("confirmed", "packed"), true);
  assert.equal(canTransitionLifecycle("packed", "shipped"), true);
  assert.equal(canTransitionLifecycle("shipped", "in_transit"), true);
});

test("partially cancelled orders can continue fulfillment for remaining items", () => {
  assert.equal(canTransitionLifecycle("partially_cancelled", "packed"), true);
  assert.equal(canTransitionLifecycle("partially_cancelled", "shipped"), true);
  assert.equal(canTransitionLifecycle("partially_cancelled", "cancelled"), false);
});

test("seller shipment events derive aggregate delivered and RTO states", () => {
  assert.equal(deriveShipmentOrderStatus([{ status: "delivered" }, { status: "in_transit" }], "confirmed"), "partially_delivered");
  assert.equal(deriveShipmentOrderStatus([{ status: "rto" }, { status: "in_transit" }], "confirmed"), "partially_rto");
  assert.equal(deriveShipmentOrderStatus([{ status: "rto" }, { status: "rto" }], "confirmed"), "rto");
});

test("COD collections support safe partial remittances and complete only at the exact total", () => {
  assert.equal(validateCodCollection({ paymentMethod: "COD", paymentStatus: "Pending", orderTotal: 1200, amount: 1200, status: "delivered" }), 1200);
  assert.throws(() => validateCodCollection({ paymentMethod: "COD", paymentStatus: "Pending", orderTotal: 1200, amount: 1300, status: "delivered" }), /AMOUNT_INVALID/);
  assert.throws(() => validateCodCollection({ paymentMethod: "COD", paymentStatus: "Pending", orderTotal: 1200, amount: 1200, status: "rto" }), /REQUIRES_DELIVERY/);
  const first = planCodCollection({ paymentMethod: "COD", paymentStatus: "Pending", orderTotal: 1200, amount: 300, status: "delivered" });
  assert.deepEqual(first, { amount: 300, paymentCollectedAmount: 300, isComplete: false });
  const second = planCodCollection({ paymentMethod: "COD", paymentStatus: "Pending", orderTotal: 1200, amount: 900, alreadyCollected: first.paymentCollectedAmount, status: "delivered" });
  assert.deepEqual(second, { amount: 900, paymentCollectedAmount: 1200, isComplete: true });
  assert.throws(() => planCodCollection({ paymentMethod: "COD", paymentStatus: "Pending", orderTotal: 1200, amount: 901, alreadyCollected: 300, status: "delivered" }), /AMOUNT_INVALID/);
});

test("only one reservation can consume the final unit", () => {
  const request = [{ productId: "part-1", quantity: 1 }];
  const firstReservation = planInventoryReservation(request, { "part-1": 1 });
  assert.deepEqual(firstReservation, [{ productId: "part-1", stock: 0 }]);
  assert.throws(() => planInventoryReservation(request, { "part-1": firstReservation[0].stock }), /out of stock/);
});

test("failed payment restores only the recorded reservation quantity", () => {
  const items = [{ productId: "part-1", quantity: 1 }, { productId: "part-1", quantity: 2 }];
  const restored = planInventoryRestock(items, { "part-1": 0 });
  assert.deepEqual(restored, [{ productId: "part-1", stock: 3 }]);
});

test("inventory plans reject invalid quantities and negative stock", () => {
  assert.throws(() => planInventoryReservation([{ productId: "part-1", quantity: 1 }], { "part-1": -1 }), /invalid stock/);
  assert.throws(() => planInventoryRestock([{ productId: "part-1", quantity: 0 }], { "part-1": 0 }), /Invalid inventory/);
});

test("payment webhook signatures are verified against the exact raw request body", () => {
  const body = Buffer.from('{"event":"payment.captured"}');
  const signature = createHmac("sha256", "webhook-secret").update(body).digest("hex");
  assert.equal(verifyWebhookSignature("webhook-secret", signature, body), true);
  assert.equal(verifyWebhookSignature("webhook-secret", signature, Buffer.from('{"event":"payment.failed"}')), false);
  assert.equal(verifyWebhookSignature("webhook-secret", "", body), false);
});
