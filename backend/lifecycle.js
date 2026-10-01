import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const ORDER_STATUSES = new Set([
  "pending",
  "confirmed",
  "processing",
  "packed",
  "shipped",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "return_window",
  "completed",
  "settled",
  "payment_failed",
  "cancelled",
  "partially_cancelled",
  "partially_delivered",
  "partially_rto",
  "rto",
  "rto_completed",
  "return_requested",
  "return_approved",
  "return_rejected",
  "refunded",
]);

const STATUS_ALIASES = new Map([
  ["placed", "pending"],
  ["payment_confirmed", "confirmed"],
  ["in transit", "in_transit"],
  ["out for delivery", "out_for_delivery"],
  ["return window", "return_window"],
  ["return requested", "return_requested"],
  ["return approved", "return_approved"],
  ["return rejected", "return_rejected"],
]);

export function normalizeLifecycleStatus(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
  return STATUS_ALIASES.get(raw.replace(/_/g, " ")) || raw;
}

export function mapShiprocketStatus(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized) return null;
  const startsWithAny = (...prefixes) => prefixes.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix} `));
  if (startsWithAny("undelivered", "delivery failed", "failed delivery", "delivery attempt failed")) return { status: "in_transit", event: "delivery_failed" };
  if (startsWithAny("rto delivered", "return to origin delivered", "returned to origin delivered", "returned to seller", "received by seller")) return { status: "rto_completed", event: "rto_completed" };
  if (startsWithAny("rto", "return to origin", "returned to origin")) return { status: "rto", event: "rto_initiated" };
  if (startsWithAny("delivered", "shipment delivered")) return { status: "delivered", event: "delivered" };
  if (startsWithAny("out for delivery", "out for dispatch")) return { status: "out_for_delivery", event: "out_for_delivery" };
  if (startsWithAny("cancelled", "canceled", "shipment cancelled", "shipment canceled")) return { status: "cancelled", event: "cancelled" };
  if (startsWithAny("return requested", "return initiated", "return received")) return { status: "return_requested", event: "return_requested" };
  if (startsWithAny("delayed", "delivery delayed", "exception")) return { status: "in_transit", event: "delayed" };
  if (startsWithAny("picked up", "shipment picked", "pickup completed", "collected")) return { status: "shipped", event: "picked_up" };
  if (startsWithAny("in transit", "shipped", "dispatched", "shipment in transit")) return { status: "in_transit", event: "in_transit" };
  if (startsWithAny("awb assigned", "manifest generated", "manifested")) return { status: "packed", event: "awb_assigned" };
  if (startsWithAny("pickup scheduled", "pickup generated", "pickup request accepted")) return { status: "packed", event: "pickup_scheduled" };
  if (startsWithAny("confirmed", "packed", "ready for pickup", "ready to ship")) return { status: "packed", event: "packed" };
  return null;
}

export function webhookEventId(provider, suppliedId, payload = {}) {
  const stable = suppliedId || payload.event_id || payload.eventId || payload.id || [payload.order_id || payload.orderId, payload.shipment_id, payload.awb_code || payload.awb, payload.status || payload.current_status, payload.current_timestamp].filter(Boolean).join(":");
  if (!stable) return null;
  return createHash("sha256").update(`${provider}:${stable}`).digest("hex");
}

export function verifyWebhookSignature(secret, signature, rawBody) {
  if (!secret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const suppliedBuffer = Buffer.from(String(signature));
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function deriveShipmentOrderStatus(shipments, fallbackStatus) {
  const active = (shipments || []).map((shipment) => normalizeLifecycleStatus(shipment.status)).filter(Boolean);
  if (!active.length) return normalizeLifecycleStatus(fallbackStatus) || "pending";
  const rtoCount = active.filter((status) => ["rto", "rto_completed"].includes(status)).length;
  const deliveredCount = active.filter((status) => status === "delivered").length;
  if (rtoCount === active.length) return active.every((status) => status === "rto_completed") ? "rto_completed" : "rto";
  if (rtoCount > 0) return "partially_rto";
  if (deliveredCount === active.length) return "delivered";
  if (deliveredCount > 0) return "partially_delivered";
  return active.find((status) => ["out_for_delivery", "in_transit", "shipped", "packed"].includes(status)) || normalizeLifecycleStatus(fallbackStatus) || "pending";
}

export function planCodCollection({ paymentMethod, paymentStatus, orderTotal, amount, status, alreadyCollected = 0 }) {
  if (paymentMethod !== "COD") throw new Error("COD_COLLECTION_REQUIRES_COD_ORDER");
  if (paymentStatus === "COD collected") throw new Error("COD_ALREADY_COLLECTED");
  if (status !== "delivered" && status !== "completed") throw new Error("COD_COLLECTION_REQUIRES_DELIVERY");
  const totalPaise = Math.round(Number(orderTotal) * 100);
  const collectedPaise = Math.round(Number(amount) * 100);
  const previousPaise = Math.round(Number(alreadyCollected) * 100);
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || !Number.isSafeInteger(collectedPaise) || collectedPaise <= 0 || !Number.isSafeInteger(previousPaise) || previousPaise < 0) throw new Error("COD_COLLECTION_AMOUNT_INVALID");
  if (previousPaise >= totalPaise) throw new Error("COD_ALREADY_COLLECTED");
  if (collectedPaise > totalPaise - previousPaise) throw new Error("COD_COLLECTION_AMOUNT_INVALID");
  const totalCollectedPaise = previousPaise + collectedPaise;
  return {
    amount: collectedPaise / 100,
    paymentCollectedAmount: totalCollectedPaise / 100,
    isComplete: totalCollectedPaise === totalPaise,
  };
}

export function validateCodCollection(options) {
  return planCodCollection(options).amount;
}

export function planInventoryRestock(items, stockByProductId) {
  const quantities = new Map();
  for (const item of items || []) {
    const productId = String(item?.productId || "").trim();
    const quantity = Number(item?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) throw new Error("Invalid inventory reservation item.");
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }

  return [...quantities].map(([productId, quantity]) => {
    const stock = Number(stockByProductId[productId]);
    if (!Number.isInteger(stock) || stock < 0) throw new Error(`Product ${productId} has invalid stock.`);
    return { productId, stock: stock + quantity };
  });
}

export function planInventoryReservation(items, stockByProductId) {
  const quantities = new Map();
  for (const item of items || []) {
    const productId = String(item?.productId || "").trim();
    const quantity = Number(item?.quantity);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) throw new Error("Invalid inventory reservation item.");
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }

  return [...quantities].map(([productId, quantity]) => {
    const stock = Number(stockByProductId[productId]);
    if (!Number.isInteger(stock) || stock < 0) throw new Error(`Product ${productId} has invalid stock.`);
    if (stock < quantity) throw new Error(`Product ${productId} is out of stock.`);
    return { productId, stock: stock - quantity };
  });
}

export function canTransitionLifecycle(from, to) {
  const current = normalizeLifecycleStatus(from);
  const next = normalizeLifecycleStatus(to);
  if (!ORDER_STATUSES.has(next)) return false;
  if (!current || current === next) return true;
  if (["cancelled", "refunded", "settled", "rto_completed"].includes(current)) return false;
  if (current === "rto") return ["rto_completed", "refunded"].includes(next);
  if (current === "partially_cancelled") return ["packed", "shipped", "in_transit", "out_for_delivery", "delivered", "return_requested", "completed"].includes(next);
  if (next === "payment_failed") return ["pending", "confirmed"].includes(current);
  if (next === "cancelled") return !["delivered", "settled", "refunded"].includes(current);
  if (next === "return_requested") return ["delivered", "return_window", "completed"].includes(current);
  if (["return_approved", "return_rejected"].includes(next)) return current === "return_requested";
  if (next === "refunded") return ["return_approved", "cancelled", "rto", "delivered", "return_window", "completed"].includes(current);
  if (next === "rto") return ["shipped", "in_transit", "out_for_delivery"].includes(current);
  const sequence = ["pending", "confirmed", "processing", "packed", "shipped", "in_transit", "out_for_delivery", "delivered", "return_window", "completed", "settled"];
  const fromIndex = sequence.indexOf(current);
  const toIndex = sequence.indexOf(next);
  return fromIndex >= 0 && toIndex >= fromIndex;
}
