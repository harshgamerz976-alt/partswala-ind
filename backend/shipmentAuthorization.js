// backend/shipmentAuthorization.js
// Authoritative gate in front of every Shiprocket shipment-creation call.
//
// The decision is made only from the stored order document (Firestore is the source of
// truth) and the verified caller identity. Client supplied payment state is never read.

import { normalizeLifecycleStatus } from "./lifecycle.js";

const IN_FLIGHT_WINDOW_MS = 120000;
const BLOCKED_ORDER_STATUSES = {
  cancelled: { status: 409, code: "ORDER_CANCELLED", message: "This order was cancelled, so no shipment can be created." },
  refunded: { status: 409, code: "ORDER_REFUNDED", message: "This order was refunded, so no shipment can be created." },
  rto_completed: { status: 409, code: "ORDER_RTO_COMPLETED", message: "This order already completed a return-to-origin journey and cannot be shipped again." },
  rto: { status: 409, code: "ORDER_RTO_IN_PROGRESS", message: "This order is returning to origin and cannot be shipped again." },
  partially_rto: { status: 409, code: "ORDER_PARTIALLY_RTO", message: "A partially returned order cannot be shipped again." },
  payment_failed: { status: 409, code: "PAYMENT_NOT_CONFIRMED", message: "This order's payment was not completed, so it cannot be shipped." },
};
const COD_PAYMENT_STATES = ["Pending", "Paid", "COD collected"];

function rejected(status, code, message) {
  return { ok: false, duplicate: false, status, code, message };
}

/** A shipment is fully recorded once the AWB and the pickup request both exist. */
export function hasCompleteShipment(order) {
  const tracking = order?.tracking || {};
  const awb = tracking.awb || tracking.trackingId;
  if (!awb) return false;
  return ["requested", "scheduled"].includes(String(tracking.pickupStatus || ""));
}

/**
 * @returns {{ ok: boolean, duplicate: boolean, status?: number, code?: string, message?: string }}
 */
export function shipmentAuthorizationProblem({ order, actor = {}, now = Date.now(), inFlightWindowMs = IN_FLIGHT_WINDOW_MS }) {
  if (!order) return rejected(404, "ORDER_NOT_FOUND", "Order not found.");
  if (!actor.uid) return rejected(401, "AUTH_REQUIRED", "Authentication required");

  const isOwner = String(order.userId || "") === String(actor.uid);
  if (!isOwner && actor.isAdmin !== true) return rejected(403, "ORDER_ACCESS_DENIED", "Order access denied");

  const status = normalizeLifecycleStatus(order.status || order.orderStatus);
  const blocked = BLOCKED_ORDER_STATUSES[status];
  if (blocked) return rejected(blocked.status, blocked.code, blocked.message);
  if (status === "refunded" || order.refundStatus === "refunded") return rejected(409, "ORDER_REFUNDED", "This order was refunded, so no shipment can be created.");
  if (Number(order.refundedAmount || 0) > 0 && String(order.refundStatus || "none") === "refunded") {
    return rejected(409, "ORDER_REFUNDED", "This order was refunded, so no shipment can be created.");
  }

  const paymentMethod = String(order.paymentMethod || "COD").toUpperCase();
  const paymentStatus = String(order.paymentStatus || "Pending");
  if (paymentMethod === "COD") {
    if (!COD_PAYMENT_STATES.includes(paymentStatus)) return rejected(409, "PAYMENT_NOT_CONFIRMED", "This order's payment state does not allow shipping yet.");
  } else {
    if (paymentStatus !== "Paid") return rejected(402, "PAYMENT_NOT_CONFIRMED", "Online payment is not confirmed for this order yet.");
    if (order.inventoryReservationStatus === "released" || status === "payment_review") {
      return rejected(409, "PAYMENT_REVIEW_REQUIRED", "This payment needs review before shipping can be created.");
    }
  }

  if (order.shippingStatus === "processing") {
    const attemptedAt = Date.parse(order.shippingAttemptAt || "") || 0;
    if (now - attemptedAt < inFlightWindowMs) {
      return rejected(202, "SHIPMENT_IN_PROGRESS", "Shipping setup is already in progress.");
    }
  }

  if (hasCompleteShipment(order)) {
    return { ok: true, duplicate: true, status: 200, code: "SHIPMENT_ALREADY_CREATED", message: "This order already has a Shiprocket shipment and AWB." };
  }

  return { ok: true, duplicate: false };
}

/** Seller suborders that still need a real Shiprocket shipment (used to avoid duplicate AWBs on retry). */
export function pendingSellerShipments(sellerSuborders, shippingShipments) {
  const existing = new Map((shippingShipments || []).map((shipment) => [`${shipment.sellerType}:${shipment.sellerId}`, shipment]));
  const recorded = (sellerSuborders || []).map((suborder) => existing.get(`${suborder.sellerType}:${suborder.sellerId}`)).filter(Boolean);
  return {
    shipments: recorded,
    pending: (sellerSuborders || []).filter((suborder) => !existing.get(`${suborder.sellerType}:${suborder.sellerId}`)?.awb),
  };
}
