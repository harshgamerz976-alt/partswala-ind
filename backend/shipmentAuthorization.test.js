import test from "node:test";
import assert from "node:assert/strict";
import { hasCompleteShipment, pendingSellerShipments, shipmentAuthorizationProblem } from "./shipmentAuthorization.js";

const owner = { uid: "customer-1", isAdmin: false };
const admin = { uid: "admin-1", isAdmin: true };

function order(overrides = {}) {
  return {
    userId: "customer-1",
    paymentMethod: "Online",
    paymentStatus: "Paid",
    status: "confirmed",
    shippingStatus: "pending",
    refundStatus: "none",
    refundedAmount: 0,
    tracking: { carrier: "Shiprocket", awb: null, pickupStatus: null },
    ...overrides,
  };
}

test("unpaid online order is rejected before any Shiprocket call", () => {
  const decision = shipmentAuthorizationProblem({ order: order({ paymentStatus: "Pending" }), actor: owner });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 402);
  assert.equal(decision.code, "PAYMENT_NOT_CONFIRMED");
});

test("paid online order is allowed", () => {
  assert.equal(shipmentAuthorizationProblem({ order: order(), actor: owner }).ok, true);
});

test("failed or released online payments need review", () => {
  assert.equal(shipmentAuthorizationProblem({ order: order({ paymentStatus: "Failed", status: "payment_failed" }), actor: owner }).ok, false);
  assert.equal(shipmentAuthorizationProblem({ order: order({ inventoryReservationStatus: "released" }), actor: owner }).code, "PAYMENT_REVIEW_REQUIRED");
});

test("COD order follows the existing COD lifecycle", () => {
  const pending = order({ paymentMethod: "COD", paymentStatus: "Pending", status: "confirmed" });
  assert.equal(shipmentAuthorizationProblem({ order: pending, actor: owner }).ok, true);
  const collected = order({ paymentMethod: "COD", paymentStatus: "COD collected", status: "delivered" });
  assert.equal(shipmentAuthorizationProblem({ order: collected, actor: owner }).ok, true);
  const failed = order({ paymentMethod: "COD", paymentStatus: "Failed", status: "payment_failed" });
  assert.equal(shipmentAuthorizationProblem({ order: failed, actor: owner }).ok, false);
});

test("cancelled, refunded, and RTO-completed orders are rejected", () => {
  assert.equal(shipmentAuthorizationProblem({ order: order({ status: "cancelled" }), actor: owner }).code, "ORDER_CANCELLED");
  assert.equal(shipmentAuthorizationProblem({ order: order({ status: "refunded", paymentStatus: "Paid" }), actor: owner }).code, "ORDER_REFUNDED");
  assert.equal(shipmentAuthorizationProblem({ order: order({ refundStatus: "refunded", refundedAmount: 100 }), actor: owner }).code, "ORDER_REFUNDED");
  assert.equal(shipmentAuthorizationProblem({ order: order({ status: "rto_completed" }), actor: owner }).code, "ORDER_RTO_COMPLETED");
  assert.equal(shipmentAuthorizationProblem({ order: order({ status: "rto" }), actor: owner }).code, "ORDER_RTO_IN_PROGRESS");
  assert.equal(shipmentAuthorizationProblem({ order: order({ status: "partially_rto" }), actor: owner }).code, "ORDER_PARTIALLY_RTO");
});

test("a completed shipment request is idempotent instead of creating a second AWB", () => {
  const completed = order({ shippingStatus: "confirmed", tracking: { awb: "AWB123", trackingId: "AWB123", pickupStatus: "requested" } });
  const decision = shipmentAuthorizationProblem({ order: completed, actor: owner });
  assert.equal(decision.ok, true);
  assert.equal(decision.duplicate, true);
  assert.equal(decision.code, "SHIPMENT_ALREADY_CREATED");
  assert.equal(hasCompleteShipment(completed), true);
  assert.equal(hasCompleteShipment(order({ tracking: { awb: "AWB123" } })), false);
});

test("an in-flight shipment request is not started twice", () => {
  const now = Date.parse("2026-09-29T10:00:00.000Z");
  const inFlight = order({ shippingStatus: "processing", shippingAttemptAt: "2026-09-29T09:59:30.000Z" });
  const decision = shipmentAuthorizationProblem({ order: inFlight, actor: owner, now });
  assert.equal(decision.ok, false);
  assert.equal(decision.status, 202);
  assert.equal(decision.code, "SHIPMENT_IN_PROGRESS");
  // A stale lock can be retried safely.
  assert.equal(shipmentAuthorizationProblem({ order: inFlight, actor: owner, now: now + 600000 }).ok, true);
});

test("an unauthorized user's order is rejected", () => {
  assert.equal(shipmentAuthorizationProblem({ order: order(), actor: { uid: "someone-else" } }).code, "ORDER_ACCESS_DENIED");
  assert.equal(shipmentAuthorizationProblem({ order: order(), actor: { uid: "someone-else" } }).status, 403);
  assert.equal(shipmentAuthorizationProblem({ order: order(), actor: {} }).code, "AUTH_REQUIRED");
  assert.equal(shipmentAuthorizationProblem({ order: null, actor: owner }).status, 404);
  // The admin/backend path is still allowed to operate on any order.
  assert.equal(shipmentAuthorizationProblem({ order: order(), actor: admin }).ok, true);
});

test("seller retries reuse recorded shipments so duplicate AWBs are never created", () => {
  const sellerSuborders = [
    { sellerId: "vendor-a", sellerType: "vendor" },
    { sellerId: "vendor-b", sellerType: "vendor" },
  ];
  const shippingShipments = [{ sellerId: "vendor-a", sellerType: "vendor", awb: "AWB-A" }];
  const { shipments, pending } = pendingSellerShipments(sellerSuborders, shippingShipments);
  assert.deepEqual(shipments, shippingShipments);
  assert.deepEqual(pending, [{ sellerId: "vendor-b", sellerType: "vendor" }]);
});
