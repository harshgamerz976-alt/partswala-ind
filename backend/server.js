import "dotenv/config";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { calculateOrderPricing } from "./pricing.js";
import { customerFacingPricing } from "./customerPricing.js";
import { getShiprocketShippingQuote } from "./shipping.js";
import { canTransitionReturnStatus, validateReturnInspection } from "./returns.js";
import { allocateMoney, buildFinanceTotals, calculateRefundReversal, groupSellerSuborders, planItemCancellation, planSelectedRefund, settlementStatusFor } from "./finance.js";
import { calculateShipmentEstimate } from "../src/services/shippingService.js";
import { assistantRoleFor, canUseAssistantTool } from "./ai/authorization.js";
import { interpretAssistantMessage } from "./ai/brain.js";
import { executeAssistantTool } from "./ai/tools.js";
import { canTransitionLifecycle, deriveShipmentOrderStatus, mapShiprocketStatus, normalizeLifecycleStatus, planCodCollection, planInventoryReservation, planInventoryRestock, verifyWebhookSignature, webhookEventId } from "./lifecycle.js";
import { createProviderRefund, normalizeProviderRefundStatus } from "./refunds.js";
import { calculateCouponApplication, normalizeCoupon } from "./coupons.js";
import { buildSellerInvoiceSnapshots } from "./invoices.js";
import { createRateLimiter } from "./rateLimiter.js";
import { assertVerifiedCustomerPhone, verifiedPhoneUpdate } from "./phoneVerification.js";
import { pendingSellerShipments, shipmentAuthorizationProblem } from "./shipmentAuthorization.js";
import { CLOUDINARY_UPLOAD_LIMIT, cloudinaryCredentialPresence, cloudinaryCredentialsFromEnvironment, signedCloudinaryUpload } from "./cloudinaryUploads.js";
import { assistantRateLimitDecision, createAssistantLimiters, resolveClientIp } from "./ai/access.js";
import { resolveLegacySellerOwnership } from "./sellerOwnership.js";
import { normalizeReturnWindowDays, isReturnWindowOpen } from "../src/services/returnPolicy.js";
import { isDeliveredPurchaseFor, publicReview, validateReviewInput } from "./reviews.js";
import { redactAuditValue } from "./audit.js";
import { firebaseIdTokenDiagnostics, verifyFirebaseIdToken } from "./authentication.js";
import { hasAdminClaim } from "./adminAuthorization.js";
import { adminLifecycleOverrideProblem } from "./adminLifecycle.js";
import { normalizeFinanceDateRange } from "./financeDateRange.js";
import { normalizeIndianState, resolveSellerTaxState, validatedDeliveryState } from "./sellerTaxContext.js";
import { hasValidVendorPickupLocation, normalizeVendorPickupLocation } from "./vendorPickup.js";
import { registerPublicSettingsRoute } from "./publicSettings.js";

const app = express();
const port = Number(process.env.PORT || 8787);
const assistantLimiters = createAssistantLimiters();
const cloudinaryUploadLimiter = createRateLimiter(CLOUDINARY_UPLOAD_LIMIT);
const cloudinaryCredentials = cloudinaryCredentialsFromEnvironment();
console.info("[Cloudinary] startup configuration:", cloudinaryCredentialPresence(cloudinaryCredentials));
const reviewLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000, maxKeys: 20000 });
const reviewReadLimiter = createRateLimiter({ limit: 60, windowMs: 60 * 1000, maxKeys: 10000 });
const shiprocketUrl = process.env.SHIPROCKET_API_URL || "https://apiv2.shiprocket.in/v1/external";
let cachedShiprocketToken = "";
let shiprocketTokenExpiresAt = 0;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || [
  process.env.FRONTEND_URL,
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:3000",
  "https://partswalaind.web.app",
  "https://partswalaind.com",
].filter(Boolean).join(",")).split(",").map((entry) => entry.trim()).filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    console.error(`[CORS] Blocked origin: ${origin}`);
    callback(new Error(`Origin ${origin} is not allowed by CORS.`));
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Express must only trust the proxies that actually sit in front of it, otherwise a caller can
// spoof X-Forwarded-For and rotate through fake IPs. `TRUST_PROXY` overrides the default:
// hosted containers behind one managed load balancer (Cloud Run/Functions) use a single hop,
// while local development trusts loopback only.
const trustProxySetting = process.env.TRUST_PROXY
  || (process.env.K_SERVICE || process.env.FUNCTION_TARGET ? "1" : "loopback");
if (/^\d+$/.test(trustProxySetting)) app.set("trust proxy", Number(trustProxySetting));
else if (trustProxySetting === "true") app.set("trust proxy", true);
else if (trustProxySetting === "false") app.set("trust proxy", false);
else app.set("trust proxy", trustProxySetting.split(",").map((entry) => entry.trim()).filter(Boolean));

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: "1mb", verify: (request, _response, buffer) => { request.rawBody = Buffer.from(buffer); } }));
app.use((request, response, next) => {
  response.set({
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  if (request.secure) response.set("Strict-Transport-Security", "max-age=31536000");
  next();
});

function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing server environment variables: ${missing.join(", ")}`);
}

function getDb() {
  return getFirestore(getFirebaseApp());
}

function getFirebaseApp() {
  requireEnv(["FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY"]);
  return getApps()[0] || initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

async function verifyRequest(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new Error("Authentication required");
  }

  try {
    const decodedToken = await verifyFirebaseIdToken(getAuth(getFirebaseApp()), authorization.slice(7), request.path);
    return decodedToken;
  } catch (error) {
    if (request.path === "/api/vendor/dashboard") {
      console.warn("Vendor dashboard Firebase ID-token verification failed:", {
        firebaseErrorCode: error?.code || "verification_error",
        firebaseErrorMessage: error?.message || "No Firebase Admin error message was provided.",
        ...firebaseIdTokenDiagnostics(authorization),
      });
    }
    console.warn("Firebase token verification failed.", error?.code || "verification_error");
    throw new Error("Invalid or expired Firebase token");
  }
}

async function shiprocketToken() {
  if (cachedShiprocketToken && shiprocketTokenExpiresAt > Date.now() + 60000) return cachedShiprocketToken;
  requireEnv(["SHIPROCKET_EMAIL", "SHIPROCKET_PASSWORD"]);
  const response = await fetch(`${shiprocketUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.SHIPROCKET_EMAIL, password: process.env.SHIPROCKET_PASSWORD }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Shiprocket login failed (${response.status})`);
  const result = await response.json();
  if (!result.token) throw new Error("Shiprocket did not return an authentication token");
  cachedShiprocketToken = result.token;
  shiprocketTokenExpiresAt = Date.now() + 8 * 60 * 60 * 1000;
  return cachedShiprocketToken;
}

function splitName(value) {
  const words = String(value || "Customer").trim().split(/\s+/);
  return { first: words.shift() || "Customer", last: words.join(" ") || "Customer" };
}

function toShiprocketPayload(orderId, order, pickupOverride = null) {
  const customer = order.customer || {};
  const name = splitName(customer.fullName || order.customerName);
  const total = Number(order.grandTotal ?? order.totalAmount ?? order.total ?? 0);
  const isCod = String(order.paymentMethod || "COD").toUpperCase() === "COD";
  const items = (order.items || []).map((item) => ({
    name: item.name || item.title || "Truck part",
    sku: item.partNumber || item.productId || `PART-${orderId}`,
    units: Number(item.quantity || 1),
    selling_price: Number(item.price || 0),
    discount: Number(item.discount || 0) / Number(item.quantity || 1),
    tax: Number(item.gstRate || 0),
  }));
  const shipment = calculateShipmentEstimate((order.items || []).map((item) => ({
    quantity: Number(item.quantity || 1),
    product: { weight: item.weight, ...(item.dimensions || {}) },
  })));
  if (!Number.isFinite(shipment.chargeableWeight) || shipment.chargeableWeight <= 0) throw new Error("A valid stored shipment weight is required before shipping can be created.");
  const pickupLocation = String(pickupOverride?.shiprocketPickupLocationId || pickupOverride?.name || process.env.SHIPROCKET_PICKUP_LOCATION || "").trim();
  if (!pickupLocation) throw new Error("Shiprocket pickup location is not configured on the backend.");
  const length = Number(process.env.SHIPROCKET_PACKAGE_LENGTH || 0);
  const breadth = Number(process.env.SHIPROCKET_PACKAGE_BREADTH || 0);
  const height = Number(process.env.SHIPROCKET_PACKAGE_HEIGHT || 0);
  const dimensions = length > 0 && breadth > 0 && height > 0 ? { length, breadth, height } : {};
  return {
    order_id: orderId,
    order_date: order.createdAt || new Date().toISOString(),
    pickup_location: pickupLocation,
    billing_customer_name: name.first,
    billing_last_name: name.last,
    billing_address: customer.streetAddress || order.address || "",
    billing_city: customer.city || "",
    billing_pincode: customer.zipCode || customer.pincode || "",
    billing_state: customer.state || "",
    billing_country: "India",
    billing_email: customer.email || order.userEmail || "",
    billing_phone: String(customer.phone || order.customerPhone || "").replace(/\D/g, "").slice(-10),
    shipping_is_billing: true,
    order_items: items,
    payment_method: isCod ? "COD" : "Prepaid",
    cod_amount: isCod ? total : 0,
    sub_total: total,
    ...dimensions,
    weight: shipment.chargeableWeight,
  };
}

async function createSellerShipment(token, orderId, order, sellerSuborder) {
  const sellerItems = (order.items || []).filter((item) => item.sellerId === sellerSuborder.sellerId && item.sellerType === sellerSuborder.sellerType);
  if (!sellerItems.length) throw new Error("Seller shipment has no order items.");
  const sellerOrder = { ...order, items: sellerItems };
  const pickup = { name: sellerSuborder.pickupName, shiprocketPickupLocationId: sellerSuborder.shiprocketPickupLocationId, pincode: sellerSuborder.pickupPincode };
  const created = await shiprocketRequest(token, "/orders/create/adhoc", toShiprocketPayload(`${orderId}-${sellerSuborder.sellerId}`, sellerOrder, pickup));
  const createdData = shiprocketData(created);
  const shiprocketOrderId = createdData.order_id || created.order_id || createdData.id || created.id || null;
  const shipmentId = createdData.shipment_id || created.shipment_id || createdData.shipmentId || created.shipmentId || null;
  if (!shiprocketOrderId || !shipmentId) throw new Error("Shiprocket did not return complete seller shipment details.");
  const awbResult = await shiprocketRequest(token, "/courier/assign/awb", { shipment_id: shipmentId });
  const awbData = shipmentDetails(awbResult);
  const awb = awbData.awb_code || awbData.awb || awbResult.awb_code || awbResult.awb || null;
  if (!awb) throw new Error("A courier could not be assigned to a seller shipment yet.");
  const pickupResult = await shiprocketRequest(token, "/courier/generate/pickup", { shipment_id: [Number(shipmentId)] });
  const pickupData = shipmentDetails(pickupResult);
  if (Number(pickupData.pickup_status ?? pickupResult.pickup_status) === 0 || pickupData.status === false || pickupData.status === 0) throw new Error("Shiprocket has not accepted the seller pickup request.");
  return { sellerId: sellerSuborder.sellerId, sellerType: sellerSuborder.sellerType, pickupLocationId: sellerSuborder.pickupLocationId, pickupPincode: sellerSuborder.pickupPincode, shiprocketOrderId, shipmentId, awb, trackingId: awb, courier: awbData.courier_name || awbData.courier || null, pickupStatus: "requested", status: "pickup_scheduled", pickupResponse: pickupResult };
}

function apiErrorMessage(result, fallback) {
  return result?.message || result?.error || result?.errors?.[0] || result?.awb_assign_error || fallback;
}

function shiprocketData(result) {
  if (!result || typeof result !== "object") return {};
  if (result.response?.data) return result.response.data;
  if (result.data) return result.data;
  if (result.response) return result.response;
  return result;
}

async function shiprocketRequest(token, path, body) {
  let response;
  let result;
  try {
    response = await fetch(`${shiprocketUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    result = await response.json();
  } catch (error) {
    console.error(`[SHIPROCKET] Request failed (${path}):`, error?.name || "network_error");
    throw new Error("Shiprocket is temporarily unavailable. The order is saved and shipping can be retried.");
  }
  if (!response.ok) {
    console.error(`[SHIPROCKET] API rejected ${path} (${response.status}).`);
    throw new Error(apiErrorMessage(result, `Shiprocket request failed (${response.status}).`));
  }
  return result;
}

function shipmentDetails(result) {
  return shiprocketData(result);
}

function appendTimelineEvent(timeline, status, timestamp, note) {
  const entries = Array.isArray(timeline) ? timeline : [];
  return [...entries.filter((event) => event.status !== status), {
    status,
    label: status.replace(/_/g, " "),
    timestamp,
    note,
  }];
}

async function releaseInventoryReservation(transaction, db, order, timestamp) {
  if (order.inventoryReservationStatus && order.inventoryReservationStatus !== "reserved") return false;
  const items = order.items || [];
  const productIds = [...new Set(items.map((item) => String(item.productId || "")).filter(Boolean))];
  const productRefs = productIds.map((productId) => db.collection("products").doc(productId));
  const productSnapshots = await Promise.all(productRefs.map((reference) => transaction.get(reference)));
  const stockByProductId = Object.fromEntries(productSnapshots.map((snapshot) => [snapshot.id, snapshot.exists ? snapshot.data()?.stock : NaN]));
  if (productSnapshots.some((snapshot) => !snapshot.exists)) throw new Error("RESERVED_PRODUCT_NOT_FOUND");
  const restocks = planInventoryRestock(items, stockByProductId);
  restocks.forEach(({ productId, stock }) => {
    const reference = db.collection("products").doc(productId);
    transaction.update(reference, { stock, updatedAt: timestamp });
  });
  return true;
}

function isAdminUser(user) {
  return hasAdminClaim(user);
}

function stageAdminAudit(transaction, db, user, { action, entityType, entityId, oldValue = null, newValue = null, reason = "", timestamp = new Date().toISOString() }) {
  const auditRef = db.collection("adminAuditLogs").doc();
  transaction.create(auditRef, {
    auditId: auditRef.id,
    actorId: user.uid,
    actorRole: isAdminUser(user) ? "admin" : "vendor",
    action,
    entityType,
    entityId: String(entityId),
    oldValue: redactAuditValue(oldValue),
    newValue: redactAuditValue(newValue),
    reason: redactAuditValue(String(reason).slice(0, 1000)),
    timestamp,
  });
}

async function submitProviderRefund(db, refundRef) {
  const startedAt = new Date().toISOString();
  const shouldSubmit = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(refundRef);
    if (!snapshot.exists) throw new Error("REFUND_REQUEST_NOT_FOUND");
    const refund = snapshot.data();
    if (["refund_completed", "provider_refund_created"].includes(refund.status)) return false;
    const processingStarted = Date.parse(refund.processingStartedAt || "");
    if (refund.status === "refund_processing" && Number.isFinite(processingStarted) && Date.now() - processingStarted < 60000) return false;
    if (!Number.isFinite(Number(refund.amount)) || Number(refund.amount) <= 0) throw new Error("INVALID_REFUND_AMOUNT");
    transaction.update(refundRef, { status: "refund_processing", processingStartedAt: startedAt, updatedAt: startedAt });
    return true;
  });
  if (!shouldSubmit) return (await refundRef.get()).data();
  const refund = (await refundRef.get()).data();
  try {
    const providerResult = await createProviderRefund({
      provider: refund.provider,
      paymentId: refund.paymentId,
      refundRequestId: refund.refundRequestId,
      amount: refund.amount,
    });
    await refundRef.update({
      status: providerResult.status,
      providerRefundId: providerResult.providerRefundId,
      providerStatus: providerResult.providerStatus,
      providerCreatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const failureEventId = createHash("sha256").update(`${refund.id || refund.refundRequestId}:provider-submission-failed`).digest("hex");
    await finalizeProviderRefund(db, refundRef, db.collection("webhookEvents").doc(failureEventId), "failed");
    await refundRef.update({ failureCode: "PROVIDER_REFUND_FAILED", failureMessage: String(error.message || "Provider refund failed.").slice(0, 300), updatedAt: new Date().toISOString() });
  }
  return (await refundRef.get()).data();
}

async function finalizeProviderRefund(db, refundRef, eventRef, providerStatus, providerRefundId = "") {
  const targetStatus = normalizeProviderRefundStatus(providerStatus);
  return db.runTransaction(async (transaction) => {
    const initialRefundSnapshot = await transaction.get(refundRef);
    if (!initialRefundSnapshot.exists) throw new Error("REFUND_REQUEST_NOT_FOUND");
    const initialRefund = initialRefundSnapshot.data();
    const orderRef = db.collection("orders").doc(String(initialRefund.orderId));
    const creditNoteQuery = db.collection("creditNotes").where("refundRequestId", "==", initialRefund.refundRequestId);
    const [refundSnapshot, eventSnapshot, orderSnapshot, creditNoteSnapshot] = await Promise.all([
      transaction.get(refundRef),
      transaction.get(eventRef),
      transaction.get(orderRef),
      transaction.get(creditNoteQuery),
    ]);
    if (eventSnapshot.exists) return { duplicate: true, status: refundSnapshot.data()?.status };
    if (!orderSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
    const refund = refundSnapshot.data();
    const order = orderSnapshot.data();
    const timestamp = new Date().toISOString();
    if (targetStatus !== "refund_completed") {
      transaction.create(eventRef, { provider: refund.provider, orderId: orderRef.id, refundRequestId: refund.refundRequestId, status: targetStatus, receivedAt: timestamp });
      transaction.update(refundRef, { status: targetStatus, providerRefundId: providerRefundId || refund.providerRefundId || null, providerStatus, updatedAt: timestamp });
      if (targetStatus === "refund_failed") {
        const pendingQuantities = { ...(order.refundPendingQuantities || {}) };
        (refund.items || []).forEach((item) => {
          const remaining = Math.max(0, Number(pendingQuantities[item.productId] || 0) - Number(item.quantity || 0));
          if (remaining) pendingQuantities[item.productId] = remaining;
          else delete pendingQuantities[item.productId];
        });
        transaction.update(orderRef, { refundPendingAmount: Math.max(0, Number((Number(order.refundPendingAmount || 0) - Number(refund.amount || 0)).toFixed(2))), refundPendingQuantities: pendingQuantities, updatedAt: timestamp });
      }
      creditNoteSnapshot.docs.forEach((snapshot) => transaction.update(snapshot.ref, { status: targetStatus, updatedAt: timestamp }));
      return { duplicate: false, status: targetStatus };
    }
    if (refund.status === "refund_completed") return { duplicate: true, status: refund.status };
    const paymentCollected = ["Paid", "COD collected"].includes(order.paymentStatus);
    const paidAmount = order.paymentStatus === "COD collected" ? Number(order.codCollectedAmount ?? order.grandTotal ?? 0) : Number(order.grandTotal || 0);
    const nextRefundedAmount = Number((Number(order.refundedAmount || 0) + Number(refund.amount || 0)).toFixed(2));
    if (!paymentCollected || nextRefundedAmount > paidAmount) throw new Error("REFUND_EXCEEDS_COLLECTED_AMOUNT");

    const orderItems = order.items || [];
    const refundItems = refund.items || [];
    const items = orderItems.map((item) => {
      const refundLine = refundItems.find((entry) => String(entry.productId) === String(item.productId));
      if (!refundLine) return item;
      const selectedQuantity = Number(refundLine.quantity || 0);
      const baseQuantity = Number(item.orderedQuantity ?? item.quantity ?? 0);
      if (!Number.isInteger(selectedQuantity) || selectedQuantity <= 0 || Number(item.refundedQuantity || 0) + selectedQuantity > baseQuantity) throw new Error("REFUND_EXCEEDS_REMAINING_QUANTITY");
      const lineRefund = Number(refundLine.lineRefundAmount ?? refundLine.refundAmount ?? 0);
      const cumulativeRefund = Number((Number(item.refundAmount || 0) + lineRefund).toFixed(2));
      const lineTotal = Number(item.originalCustomerLineTotal ?? item.customerLineTotal ?? 0);
      const ratio = lineTotal > 0 ? Math.min(1, cumulativeRefund / lineTotal) : 0;
      const scaled = (value) => Number((Number(value || 0) * (1 - ratio)).toFixed(2));
      return {
        ...item,
        refundedQuantity: Number(item.refundedQuantity || 0) + selectedQuantity,
        refundAmount: cumulativeRefund,
        sellerSubtotal: scaled(item.originalSellerSubtotal ?? item.sellerSubtotal),
        taxableValue: scaled(item.originalTaxableValue ?? item.taxableValue),
        taxRefundAmount: Number((Number(item.taxRefundAmount || 0) + Number(refundLine.taxAmount || refundLine.taxAmountReversal || 0)).toFixed(2)),
        commissionAmount: scaled(item.originalCommissionAmount ?? item.commissionAmount),
        vendorPayout: scaled(item.originalVendorPayout ?? item.vendorPayout),
        platformRevenue: scaled(item.originalPlatformRevenue ?? item.platformRevenue),
        settlementStatus: item.sellerType === "vendor" ? "held" : item.settlementStatus,
      };
    });
    const finance = buildFinanceTotals(items, {
      shippingChargedToCustomer: order.shippingChargedToCustomer || 0,
      shippingRefundAmount: order.shippingRefundAmount || 0,
      codFeeAmount: order.codFee || 0,
      codFeeRefundAmount: order.codFeeRefundAmount || 0,
      actualShippingCost: order.actualShippingCost,
      paymentGatewayFee: order.paymentGatewayFee,
      paymentGatewayTax: order.paymentGatewayTax,
      refundAmount: nextRefundedAmount,
      shippingDifferencePolicy: order.finance?.shippingDifferencePolicy || "absorb",
    });
    const settlementRefs = [...new Set(refundItems.map((item) => item.settlementId).filter(Boolean))].map((settlementId) => db.collection("vendorSettlements").doc(settlementId));
    const settlementSnapshots = await Promise.all(settlementRefs.map((settlementRef) => transaction.get(settlementRef)));
    const settlementById = new Map(settlementSnapshots.map((snapshot) => [snapshot.id, snapshot]));
    const pendingQuantities = { ...(order.refundPendingQuantities || {}) };
    refundItems.forEach((item) => {
      const remaining = Math.max(0, Number(pendingQuantities[item.productId] || 0) - Number(item.quantity || 0));
      if (remaining) pendingQuantities[item.productId] = remaining;
      else delete pendingQuantities[item.productId];
    });
    transaction.create(eventRef, { provider: refund.provider, orderId: orderRef.id, refundRequestId: refund.refundRequestId, status: targetStatus, receivedAt: timestamp });
    for (const item of items) {
      if (!item.settlementId || !refundItems.some((refundLine) => refundLine.productId === item.productId)) continue;
      const settlementSnapshot = settlementById.get(item.settlementId);
      if (!settlementSnapshot?.exists) continue;
      const settlement = settlementSnapshot.data();
      if (settlement.settlementStatus === "paid") {
        const adjustmentId = `${refund.refundRequestId}_${createHash("sha256").update(item.settlementId).digest("hex").slice(0, 12)}`;
        const adjustmentRef = db.collection("financeAdjustments").doc(adjustmentId);
        const oldAmount = Number(settlement.vendorPayout || 0);
        const newNetAmount = Number(item.vendorPayout || 0);
        transaction.create(adjustmentRef, { adjustmentId, originalTransaction: item.settlementId, orderId: orderRef.id, vendorId: item.sellerId, action: "provider_refund_payout_reversal", oldAmount, adjustmentAmount: Number((newNetAmount - oldAmount).toFixed(2)), newNetAmount, reason: refund.reason || "Customer refund", adminId: refund.requestedBy, timestamp });
      } else {
        transaction.update(settlementSnapshot.ref, { sellerSubtotal: item.sellerSubtotal, refundAmount: Number((Number(settlement.refundAmount || 0) + Number(refundItems.find((line) => line.productId === item.productId).lineRefundAmount || refundItems.find((line) => line.productId === item.productId).refundAmount || 0)).toFixed(2)), commissionAmount: item.commissionAmount, vendorPayout: item.vendorPayout, settlementStatus: "held", orderStatus: "partially_cancelled", updatedAt: timestamp });
      }
    }
    transaction.update(orderRef, {
      items,
      sellerSuborders: groupSellerSuborders(items).map((row, index) => ({ ...row, id: `${orderRef.id}_seller_${index}`, orderId: orderRef.id })),
      refundedAmount: nextRefundedAmount,
      refundPendingAmount: Math.max(0, Number((Number(order.refundPendingAmount || 0) - Number(refund.amount || 0)).toFixed(2))),
      refundPendingQuantities: pendingQuantities,
      refundAmount: nextRefundedAmount,
      refundStatus: nextRefundedAmount >= paidAmount ? "refunded" : "partial",
      refundCompletedAt: timestamp,
      finance,
      vendorPayables: finance.vendorPayables,
      platformCommission: finance.platformCommission,
      platformRevenue: finance.platformRevenue,
      updatedAt: timestamp,
    });
    transaction.update(refundRef, { status: targetStatus, providerRefundId: providerRefundId || refund.providerRefundId || null, providerStatus, completedAt: timestamp, updatedAt: timestamp });
    creditNoteSnapshot.docs.forEach((snapshot) => transaction.update(snapshot.ref, { status: targetStatus, updatedAt: timestamp }));
    return { duplicate: false, status: targetStatus, refundedAmount: nextRefundedAmount };
  });
}

function shippingOrderValue(items, productsById, couponRate) {
  let subtotalPaise = 0;
  for (const item of items) {
    const product = productsById[String(item?.productId || item?.id || "")];
    if (!product) continue;
    const quantity = Number(item.quantity || 0);
    const unitPricePaise = Math.round(Number(product.price || 0) * 100);
    const mrpPaise = Number(product.mrp) > 0 ? Math.round(Number(product.mrp) * 100) : 0;
    const productValue = mrpPaise > 0
      ? unitPricePaise * quantity
      : Math.round(unitPricePaise * quantity * (1 - Number(product.discountPercent || 0) / 100));
    subtotalPaise += productValue;
  }
  const couponDiscountPaise = Math.round(subtotalPaise * couponRate);
  const netPaise = Math.max(0, subtotalPaise - couponDiscountPaise);
  return Number((netPaise / 100).toFixed(2));
}

async function checkoutShippingQuote({ payload, productsById, storeSettings, couponRate }) {
  const deliveryPincode = String(payload.customer?.zipCode || payload.customer?.pincode || "").trim();
  if (!/^\d{6}$/.test(deliveryPincode)) {
    const error = new Error("Enter a valid 6-digit delivery pincode to calculate shipping.");
    error.code = "SHIPPING_UNAVAILABLE";
    throw error;
  }
  const groups = new Map();
  for (const item of payload.items || []) {
    const product = productsById[String(item.productId || item.id || "")];
    const sellerType = product?.sellerType === "vendor" ? "vendor" : "partswala";
    const sellerId = sellerType === "vendor" ? String(product.sellerId || "") : "partswala";
    const key = `${sellerType}:${sellerId}`;
    const group = groups.get(key) || { sellerId, sellerType, items: [], productsById: {} };
    group.items.push(item);
    group.productsById[String(item.productId || item.id || "")] = product;
    groups.set(key, group);
  }
  const freeShippingThreshold = Number(storeSettings.freeShippingThreshold || 0);
  try {
    const token = await shiprocketToken();
    const sellerQuotes = await Promise.all([...groups.values()].map(async (group) => {
      const pickup = group.sellerType === "vendor"
        ? group.productsById[Object.keys(group.productsById)[0]]?.pickupLocation
        : { pickupLocationId: "partswala", pincode: storeSettings.pickupPincode || process.env.SHIPROCKET_PICKUP_PINCODE, state: storeSettings.businessState, name: storeSettings.storeName || "PARTSWALA IND" };
      if (!pickup?.isActive && group.sellerType === "vendor") throw Object.assign(new Error("Shipping unavailable: seller pickup location is not configured."), { code: "SHIPPING_UNAVAILABLE" });
      const pickupPincode = String(pickup?.pincode || "").trim();
      if (!/^\d{6}$/.test(pickupPincode)) throw Object.assign(new Error(group.sellerType === "vendor" ? "Shipping unavailable: seller pickup location is not configured." : "Pickup pincode is missing or invalid for this shipment."), { code: "SHIPPING_UNAVAILABLE" });
      const shipment = calculateShipmentEstimate(group.items.map((item) => ({ quantity: Number(item.quantity || 0), product: group.productsById[String(item.productId || item.id || "")] })), { pickupPincode, deliveryPincode, paymentMethod: payload.paymentMethod });
      if (!Number.isFinite(shipment.chargeableWeight) || shipment.chargeableWeight <= 0) throw Object.assign(new Error("A valid product weight is required to calculate shipping."), { code: "SHIPPING_UNAVAILABLE" });
      const orderValue = shippingOrderValue(group.items, group.productsById, couponRate);
      const dimensions = group.items.map((item) => group.productsById[String(item.productId || item.id || "")]?.dimensions || {});
      const quote = await getShiprocketShippingQuote({ baseUrl: shiprocketUrl, token, pickupLocationId: pickup.pickupLocationId || group.sellerId, dimensions, pickupPincode, deliveryPincode, chargeableWeight: shipment.chargeableWeight, cod: String(payload.paymentMethod || "COD").toUpperCase() === "COD", orderValue });
      const free = freeShippingThreshold > 0 && orderValue >= freeShippingThreshold;
      return { ...quote, amount: free ? 0 : quote.amount, quotedAmount: quote.amount, customerShippingFree: free, sellerId: group.sellerId, sellerType: group.sellerType, pickupLocationId: pickup.pickupLocationId || group.sellerId, pickupName: pickup.name || "", shiprocketPickupLocationId: pickup.shiprocketPickupLocationId || pickup.name || "", pickupPincode, shippingWeight: shipment.chargeableWeight, dimensions };
    }));
    return { available: true, amount: Number(sellerQuotes.reduce((sum, quote) => sum + Number(quote.amount || 0), 0).toFixed(2)), quotedAmount: Number(sellerQuotes.reduce((sum, quote) => sum + Number(quote.quotedAmount || 0), 0).toFixed(2)), provider: "shiprocket", isEstimate: true, sellerQuotes, deliveryPincode };
  } catch (cause) {
    const error = new Error(cause?.code === "SHIPPING_UNAVAILABLE"
      ? cause.message
      : "Shipping provider could not return a quote. Try again later.");
    error.code = "SHIPPING_UNAVAILABLE";
    throw error;
  }
}

async function calculateCheckout(db, payload, transaction = null, { userId = "", consumeCoupon = false } = {}) {
  if (!Array.isArray(payload?.items) || payload.items.length === 0 || payload.items.length > 50) {
    throw new Error("Your cart is empty or contains too many different products.");
  }
  const productIds = [...new Set(payload.items.map((item) => String(item?.productId || item?.id || "").trim()).filter(Boolean))];
  const productRefs = productIds.map((productId) => db.collection("products").doc(productId));
  const storeRef = db.doc("settings/store");
  const couponCode = String(payload.couponCode || "").trim().toUpperCase();
  const couponRef = couponCode ? db.doc("coupons/codes") : null;
  const couponCampaignRef = couponCode ? db.collection("couponCampaigns").doc(couponCode) : null;
  const couponCounterRef = couponCode ? db.collection("couponCounters").doc(couponCode) : null;
  const couponUsageId = couponCode && userId ? createHash("sha256").update(`${couponCode}:${userId}`).digest("hex") : null;
  const couponUsageRef = couponUsageId ? db.collection("couponUsage").doc(couponUsageId) : null;
  const read = (reference) => transaction ? transaction.get(reference) : reference.get();
  const [storeSnapshot, couponSnapshot, couponCampaignSnapshot, couponCounterSnapshot, couponUsageSnapshot, ...productSnapshots] = await Promise.all([
    read(storeRef),
    couponRef ? read(couponRef) : Promise.resolve(null),
    couponCampaignRef ? read(couponCampaignRef) : Promise.resolve(null),
    couponCounterRef ? read(couponCounterRef) : Promise.resolve(null),
    couponUsageRef ? read(couponUsageRef) : Promise.resolve(null),
    ...productRefs.map(read),
  ]);
  const storeSettings = storeSnapshot.exists ? storeSnapshot.data() : {};
  const productsById = Object.fromEntries(productSnapshots.map((snapshot) => [snapshot.id, snapshot.exists ? snapshot.data() : null]));
  const productCostSnapshots = await Promise.all(productIds.map((productId) => read(db.collection("productCosts").doc(productId))));
  productCostSnapshots.forEach((snapshot, index) => {
    if (snapshot.exists && productsById[productIds[index]]?.sellerType !== "vendor") {
      productsById[productIds[index]].costPrice = snapshot.data().costPrice;
    }
  });
  const legacyVendorProductIds = productSnapshots.filter((snapshot) => {
    if (!snapshot.exists || snapshot.data().sellerType) return false;
    return true;
  }).map((snapshot) => snapshot.id);
  if (legacyVendorProductIds.length) {
    const ownership = await resolveLegacySellerOwnership(legacyVendorProductIds, async (productIds) => {
      const linkQueries = [];
      for (let index = 0; index < productIds.length; index += 30) {
        const linkQuery = db.collection("vendorProductLinks").where("productId", "in", productIds.slice(index, index + 30));
        linkQueries.push(transaction ? transaction.get(linkQuery) : linkQuery.get());
      }
      const linkSnapshots = await Promise.all(linkQueries);
      return linkSnapshots.flatMap((snapshot) => snapshot.docs.map((link) => ({ id: link.id, ...link.data() })));
    });
    for (const [productId, owner] of ownership) Object.assign(productsById[productId], owner);
  }
  const vendorIds = [...new Set(Object.values(productsById).filter((product) => product?.sellerType === "vendor" && product.sellerId).map((product) => String(product.sellerId)))];
  if (vendorIds.length) {
    const vendorSnapshots = await Promise.all(vendorIds.map((vendorId) => read(db.collection("users").doc(vendorId))));
    const vendorById = new Map(vendorSnapshots.map((snapshot, index) => [vendorIds[index], snapshot.exists ? snapshot.data()?.vendorProfile || {} : {}]));
    for (const product of Object.values(productsById)) {
      if (product?.sellerType !== "vendor") continue;
      const vendor = vendorById.get(String(product.sellerId)) || {};
      product.pickupLocation = vendor.pickupLocation || null;
      product.vendorAddress = vendor.businessAddress || "";
      product.vendorGstin = vendor.gstin || "";
      product.sellerState = resolveSellerTaxState({ product, vendorProfile: vendor, partswalaState: storeSettings.businessState });
    }
  }
  let couponRate = 0;
  let couponApplication = null;
  if (couponCode) {
    const campaign = couponCampaignSnapshot?.exists ? couponCampaignSnapshot.data() : null;
    const legacyValue = couponSnapshot?.exists ? couponSnapshot.data()?.[couponCode] : null;
    const coupon = normalizeCoupon(couponCode, campaign, legacyValue);
    const couponItems = (payload.items || []).map((entry) => {
      const productId = String(entry.productId || entry.id || "");
      const product = productsById[productId];
      if (!product) return null;
      const quantity = Number(entry.quantity || 0);
      const price = Number(product.price || 0);
      const mrp = Number(product.mrp) > 0 ? Number(product.mrp) : price;
      const gross = mrp * quantity;
      const productDiscount = Number(product.mrp) > 0 ? Math.max(0, gross - price * quantity) : Math.round(gross * Number(product.discountPercent || 0) / 100);
      const sellerType = product.sellerType === "vendor" && product.sellerId ? "vendor" : "partswala";
      return { productId, category: product.category, sellerId: sellerType === "vendor" ? product.sellerId : "partswala", discountedValue: Number((gross - productDiscount).toFixed(2)) };
    }).filter(Boolean);
    couponApplication = calculateCouponApplication({
      coupon,
      items: couponItems,
      globalUsageCount: Number(couponCounterSnapshot?.data()?.usageCount || 0),
      userUsageCount: Number(couponUsageSnapshot?.data()?.usageCount || 0),
    });
    const orderSubtotal = couponItems.reduce((sum, item) => sum + Number(item.discountedValue || 0), 0);
    couponRate = orderSubtotal > 0 ? Math.min(1, couponApplication.discountAmount / orderSubtotal) : 0;
  }
  const shippingQuote = await checkoutShippingQuote({ payload, productsById, storeSettings, couponRate });
  const pricing = calculateOrderPricing({
    items: payload.items,
    productsById,
    settings: storeSettings,
    couponRate,
    couponApplication,
    customerState: validatedDeliveryState(payload.customer?.state),
    pickupPincode: storeSettings.pickupPincode || process.env.SHIPROCKET_PICKUP_PINCODE,
    deliveryPincode: payload.customer?.zipCode || payload.customer?.pincode,
    paymentMethod: payload.paymentMethod,
    shippingQuote,
  });
  return {
    pricing,
    couponCode: couponCode || null,
    couponApplication,
    storeSettings,
    couponCounterRef,
    couponUsageRef,
    couponCounter: Number(couponCounterSnapshot?.data()?.usageCount || 0),
    couponUserUsage: Number(couponUsageSnapshot?.data()?.usageCount || 0),
    consumeCoupon,
  };
}

async function authenticatedUser(request, response) {
  try {
    return await verifyRequest(request);
  } catch (error) {
    response.status(401).json({ message: error.message || "Authentication required" });
    return null;
  }
}

function normalizeCustomer(payload, user) {
  const source = payload?.customer || {};
  const customerState = normalizeIndianState(source.state);
  if (!customerState) throw new Error("Enter a valid Indian delivery state to calculate GST.");
  const customer = {
    fullName: String(source.fullName || source.name || "").trim(),
    email: String(source.email || user.email || "").trim(),
    phone: String(source.phone || "").trim(),
    streetAddress: String(source.streetAddress || source.address || "").trim(),
    addressLine2: String(source.addressLine2 || "").trim(),
    city: String(source.city || "").trim(),
    state: customerState,
    zipCode: String(source.zipCode || source.pincode || "").trim(),
  };
  const missing = Object.entries(customer).filter(([key, value]) => !["email", "addressLine2"].includes(key) && !value).map(([key]) => key);
  if (missing.length) throw new Error("Complete your delivery name, phone, street, city, state, and PIN code.");
  return customer;
}
app.get("/health", (_request, response) => response.json({ ok: true, service: "partswala-ind-backend" }));
registerPublicSettingsRoute(app, getDb);

app.get("/api/reviews", async (request, response) => {
  const productId = String(request.query.productId || "").trim();
  if (!productId || productId.length > 200) return response.status(400).json({ message: "A valid product ID is required." });
  const limit = reviewReadLimiter.check(`ip:${resolveClientIp(request)}`);
  if (!limit.allowed) return response.status(429).json({ message: "Too many review requests. Try again shortly." });
  try {
    const snapshot = await getDb().collection("reviews").where("productId", "==", productId).orderBy("createdAt", "desc").limit(100).get();
    return response.json({ reviews: snapshot.docs.map((document) => publicReview(document.data(), document.id)) });
  } catch (error) {
    console.error("Public product reviews could not be loaded.", error?.code || "firestore_error");
    return response.status(500).json({ message: "Product reviews could not be loaded." });
  }
});

app.post("/api/reviews", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  const limit = reviewLimiter.check(`uid:${user.uid}`);
  if (!limit.allowed) return response.status(429).json({ message: "You have submitted several reviews recently. Try again later." });
  let review;
  try {
    review = validateReviewInput(request.body);
  } catch (error) {
    return response.status(400).json({ message: error.message });
  }
  try {
    const db = getDb();
    const productSnapshot = await db.collection("products").doc(review.productId).get();
    if (!productSnapshot.exists) return response.status(404).json({ message: "Product not found." });

    let cursor = null;
    let hasDeliveredPurchase = false;
    while (!hasDeliveredPurchase) {
      let query = db.collection("orders").where("userId", "==", user.uid).limit(100);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;
      hasDeliveredPurchase = page.docs.some((snapshot) => isDeliveredPurchaseFor(snapshot.data(), user.uid, review.productId));
      cursor = page.docs.at(-1);
      if (page.size < 100) break;
    }
    if (!hasDeliveredPurchase) return response.status(403).json({ message: "A paid, delivered purchase of this product is required to review it." });

    const reviewId = createHash("sha256").update(`${user.uid}:${review.productId}`).digest("hex");
    const reviewRef = db.collection("reviews").doc(reviewId);
    const createdAt = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(reviewRef);
      if (existing.exists) throw new Error("REVIEW_ALREADY_EXISTS");
      transaction.create(reviewRef, {
        productId: review.productId,
        userId: user.uid,
        userName: String(user.name || "Verified customer").slice(0, 80),
        rating: review.rating,
        text: review.text,
        verifiedPurchase: true,
        createdAt,
      });
    });
    return response.status(201).json({ ok: true, reviewId });
  } catch (error) {
    if (error.message === "REVIEW_ALREADY_EXISTS") return response.status(409).json({ message: "You have already reviewed this product." });
    console.error("Review submission failed:", error.message || error);
    return response.status(500).json({ message: "Your review could not be submitted." });
  }
});

/**
 * The backend — never the browser — records that a phone number is verified. The claimed number
 * must match the `phone_number` claim on the caller's Firebase ID token, which only Firebase
 * Phone Auth can set.
 */
app.post("/api/phone/verification", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  const decision = verifiedPhoneUpdate({ tokenPhoneNumber: user.phone_number, claimedPhone: request.body?.phone });
  if (decision.status) return response.status(decision.status).json({ message: decision.message, code: decision.code });
  try {
    const db = getDb();
    const userRef = db.collection("users").doc(user.uid);
    const timestamp = decision.update.phoneVerifiedAt;
    const eventRef = db.collection("phoneVerificationEvents").doc(createHash("sha256").update(`${user.uid}:${decision.update.verifiedPhone}:${timestamp}`).digest("hex"));
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      const existing = snapshot.exists ? snapshot.data() : {};
      if (!snapshot.exists) transaction.create(userRef, { email: user.email || "", role: "customer", createdAt: timestamp, ...decision.update });
      else transaction.update(userRef, decision.update);
      transaction.create(eventRef, {
        uid: user.uid,
        phone: decision.update.verifiedPhone,
        previousPhone: existing.phone || null,
        method: decision.update.phoneVerificationMethod,
        verifiedAt: timestamp,
      });
    });
    return response.json({ ok: true, ...decision.update });
  } catch (error) {
    console.error("Phone verification could not be saved:", error?.message || error);
    return response.status(503).json({ message: "Your phone verification could not be saved right now. Please try again." });
  }
});

app.post("/api/uploads/cloudinary/signature", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  const limit = cloudinaryUploadLimiter.check(`uid:${user.uid}`);
  if (!limit.allowed) {
    return response.status(429).json({ message: `Too many image uploads. Try again in ${Math.max(1, Math.ceil(limit.retryAfterMs / 1000))} seconds.` });
  }
  let role = isAdminUser(user) ? "admin" : "customer";
  if (role === "customer") {
    try {
      const profileSnapshot = await getDb().collection("users").doc(user.uid).get();
      const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
      if (profile?.role === "vendor" && profile?.vendorStatus === "approved") role = "vendor";
    } catch (error) {
      console.warn("Upload folder role lookup failed:", error?.message || error);
    }
  }
  const signed = signedCloudinaryUpload({
    ...cloudinaryCredentials,
    uid: user.uid,
    role,
    purpose: request.body?.purpose,
    uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET || "",
  });
  if (signed.status) return response.status(signed.status).json({ message: signed.message, code: signed.code, missingVariables: signed.missingVariables });
  return response.json(signed);
});

async function requireVerifiedCustomerPhone(db, user, customerPhone, transaction = null) {
  const profileRef = db.collection("users").doc(user.uid);
  const profileSnapshot = transaction ? await transaction.get(profileRef) : await profileRef.get();
  const profile = profileSnapshot.exists ? profileSnapshot.data() : null;
  return assertVerifiedCustomerPhone({ profile, customerPhone, tokenPhoneNumber: user.phone_number });
}



const PHONE_VERIFICATION_CODES = new Set(["INVALID_PHONE", "PHONE_NOT_VERIFIED", "PHONE_VERIFICATION_INCOMPLETE", "PHONE_MISMATCH", "PHONE_CHANGED", "PHONE_AUTH_REQUIRED", "PHONE_VERIFIER_MISMATCH"]);

/** Sends the understandable checkout response for a missing, unverified, or mismatched phone number. */
function respondToPhoneVerificationError(error, response) {
  if (!PHONE_VERIFICATION_CODES.has(error?.code)) return false;
  response.status(error.code === "PHONE_NOT_VERIFIED" ? 403 : 400).json({ message: error.message, code: error.code });
  return true;
}

app.post("/api/checkout/quote", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  try {
    const db = getDb();
    const requestedPhone = String(request.body?.customer?.phone || "").trim();
    const profile = (await db.collection("users").doc(user.uid).get()).data();
    await assertVerifiedCustomerPhone({ profile, customerPhone: requestedPhone || profile?.verifiedPhone || profile?.phone, tokenPhoneNumber: user.phone_number });
    const { pricing, couponCode } = await calculateCheckout(db, request.body || {}, null, { userId: user.uid });
    return response.json({ pricing: customerFacingPricing(pricing), couponCode });
  } catch (error) {
    if (respondToPhoneVerificationError(error, response)) return;
    console.error("Checkout quote failed:", error);
    const status = error.code === "SHIPPING_UNAVAILABLE" ? 503 : error.code ? 500 : 400;
    return response.status(status).json({ message: error.message || "Checkout pricing could not be calculated." });
  }
});

app.post("/api/orders", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  try {
    const db = getDb();
    const payload = request.body || {};
    const customer = normalizeCustomer(payload, user);
    await requireVerifiedCustomerPhone(db, user, customer.phone);
    const paymentMethod = String(payload.paymentMethod || "COD");
    if (!["COD", "Online", "PhonePe"].includes(paymentMethod)) return response.status(400).json({ message: "Choose a supported payment method." });
    const idempotencyKey = String(payload.idempotencyKey || request.headers["idempotency-key"] || "").trim();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 128) return response.status(400).json({ message: "A valid checkout idempotency key is required." });
    const idempotencyId = createHash("sha256").update(`${user.uid}:${idempotencyKey}`).digest("hex");
    const idempotencyRef = db.collection("orderIdempotency").doc(idempotencyId);
    const orderRef = db.collection("orders").doc();
    const orderFinanceRef = db.collection("orderFinance").doc(orderRef.id);
    const createdAt = new Date().toISOString();
    const orderData = await db.runTransaction(async (transaction) => {
      const idempotencySnapshot = await transaction.get(idempotencyRef);
      if (idempotencySnapshot.exists) return { orderId: idempotencySnapshot.data().orderId, duplicate: true };
      await requireVerifiedCustomerPhone(db, user, customer.phone, transaction);
      const { pricing, couponCode, couponApplication, storeSettings, couponCounterRef, couponUsageRef, couponCounter, couponUserUsage } = await calculateCheckout(db, payload, transaction, { userId: user.uid, consumeCoupon: true });
      pricing.items.forEach((item, index) => {
        if (item.sellerType === "vendor") item.settlementId = `${orderRef.id}_${index}`;
      });
      const status = paymentMethod === "COD" ? "confirmed" : "pending";
      const finalizedItems = pricing.items.map(({ productCost: _productCost, ...item }) => ({
        ...item,
        orderedQuantity: item.quantity,
        remainingQuantity: item.quantity,
        cancelledQuantity: 0,
        refundedQuantity: 0,
        originalSellerSubtotal: item.sellerSubtotal,
        originalTaxableValue: item.taxableValue,
        originalTaxAmount: item.taxAmount,
        originalCgst: item.cgst,
        originalSgst: item.sgst,
        originalIgst: item.igst,
        originalCustomerLineTotal: item.customerLineTotal,
        originalShippingChargedToCustomer: item.shippingChargedToCustomer,
        originalShippingTaxableValue: item.shippingTaxableValue,
        originalCodFee: item.codFee,
        originalCodFeeTaxableValue: item.codFeeTaxableValue,
      }));
      const sellerInvoiceSnapshots = buildSellerInvoiceSnapshots(orderRef.id, createdAt, {
        storeName: storeSettings.storeName || "PARTSWALA IND",
        address: storeSettings.address || "",
        gst: storeSettings.gst || "",
        state: storeSettings.businessState,
      }, finalizedItems);
      const invoiceBySeller = new Map(sellerInvoiceSnapshots.map((snapshot) => [`${snapshot.seller.sellerType}:${snapshot.seller.sellerId}`, snapshot.invoiceNumber]));
      finalizedItems.forEach((item) => { item.sellerInvoiceNumber = invoiceBySeller.get(`${item.sellerType}:${item.sellerId}`); });
      const order = {
        userId: user.uid,
        userEmail: user.email || customer.email,
        customerName: customer.fullName,
        customerPhone: customer.phone,
        customer,
        seller: {
          storeName: storeSettings.storeName || "PARTSWALA IND",
          address: storeSettings.address || "",
          gst: storeSettings.gst || "",
          state: storeSettings.businessState,
        },
        invoiceNumber: orderRef.id,
        invoiceDate: createdAt,
        sellerInvoiceSnapshots,
        orderTotals: {
          mrpTotal: pricing.mrpTotal,
          productDiscount: pricing.productDiscount,
          couponDiscount: pricing.couponDiscount,
          productGross: pricing.productGross,
          taxableProductValue: pricing.taxableProductValue,
          cgst: pricing.cgst,
          sgst: pricing.sgst,
          igst: pricing.igst,
          totalGst: pricing.gstTotal,
          customerShipping: pricing.shippingCharge,
          actualShippingCost: null,
          shippingDifference: null,
          shippingCalculationStatus: pricing.shippingIsFree ? "free" : "quoted",
          shippingProvider: pricing.shippingQuote?.provider || null,
          shippingQuoteId: pricing.shippingQuote?.rateId || null,
          shippingService: pricing.shippingQuote?.courierName || null,
          shippingWeight: pricing.shippingChargeableWeight,
          pickupLocationId: pricing.items[0]?.pickupLocationId || null,
          pickupPincode: pricing.shippingPickupPincode,
          deliveryPincode: pricing.shippingDeliveryPincode,
          shippingPolicy: storeSettings.shippingDifferencePolicy || "absorb",
          codFee: pricing.codFee,
          customerFees: 0,
          customerTotal: pricing.grandTotal,
          paymentGatewayFee: paymentMethod === "COD" ? 0 : null,
          paymentGatewayTax: paymentMethod === "COD" ? 0 : null,
          netPaymentReceived: null,
        },
        sellerFinancials: pricing.sellerSuborders,
        address: [customer.streetAddress, customer.addressLine2, customer.city, `${customer.state} - ${customer.zipCode}`].filter(Boolean).join(", "),
        items: finalizedItems,
        sellerSuborders: pricing.sellerSuborders.map((suborder, index) => ({ ...suborder, id: `${orderRef.id}_seller_${index}`, orderId: orderRef.id })),
        finance: pricing.finance,
        subtotal: pricing.subtotal,
        productDiscount: pricing.productDiscount,
        couponDiscount: pricing.couponDiscount,
        discount: pricing.discount,
        taxableAmount: pricing.taxableAmount,
        merchandiseTaxableAmount: pricing.merchandiseTaxableAmount,
        shipping: pricing.shippingCharge,
        shippingCharge: pricing.shippingCharge,
        shippingEstimate: {
          isEstimate: pricing.shippingIsEstimate,
          isFree: pricing.shippingIsFree,
          provider: pricing.shippingQuote?.provider || (pricing.shippingIsFree ? "configured-free-shipping" : "unknown"),
          courierName: pricing.shippingQuote?.courierName || "",
          quotedAmount: pricing.shippingQuote?.quotedAmount ?? pricing.shippingCharge,
          customerShippingFree: pricing.shippingQuote?.customerShippingFree === true,
          quotedAt: pricing.shippingQuote?.quotedAt || createdAt,
          pickupPincode: pricing.shippingPickupPincode,
          deliveryPincode: pricing.shippingDeliveryPincode,
          actualWeight: pricing.shippingActualWeight,
          volumetricWeight: pricing.shippingVolumetricWeight,
          chargeableWeight: pricing.shippingChargeableWeight,
          amount: pricing.shippingCharge,
        },
        shiprocketShippingCost: null,
        shippingTaxableAmount: pricing.shippingTaxableAmount,
        codFee: pricing.codFee,
        codFeeTaxableAmount: pricing.codFeeTaxableAmount,
        cgst: pricing.cgst,
        sgst: pricing.sgst,
        igst: pricing.igst,
        gstTotal: pricing.gstTotal,
        gstGroups: pricing.gstGroups,
        taxMode: pricing.taxMode,
        shippingTaxTreatment: pricing.shippingTaxTreatment,
        codFeeTaxTreatment: pricing.codFeeTaxTreatment,
        grandTotal: pricing.grandTotal,
        originalGrandTotal: pricing.grandTotal,
        total: pricing.grandTotal,
        totalAmount: pricing.grandTotal,
        paymentMethod,
        paymentGateway: paymentMethod === "Online" ? "razorpay" : paymentMethod === "PhonePe" ? "phonepe" : null,
        paymentId: null,
        paymentStatus: "Pending",
        paymentCollectedAmount: 0,
        codCollectedAmount: 0,
        inventoryReservationStatus: "reserved",
        couponCode,
        couponSnapshot: couponApplication ? {
          ...couponApplication,
          discountAmount: pricing.couponDiscount,
          lineAllocations: pricing.items.map((item) => ({ productId: item.productId, discount: item.couponDiscount })),
        } : null,
        refundedAmount: 0,
        refundStatus: "none",
        returnWindowDays: normalizeReturnWindowDays(storeSettings.returnWindowDays),
        shippingChargedToCustomer: pricing.shippingCharge,
        shippingCalculationStatus: pricing.shippingIsFree ? "free" : "quoted",
        shippingProvider: pricing.shippingQuote?.provider || null,
        shippingQuoteId: pricing.shippingQuote?.rateId || null,
        shippingService: pricing.shippingQuote?.courierName || null,
        shippingWeight: pricing.shippingChargeableWeight,
        pickupLocationId: pricing.items[0]?.pickupLocationId || null,
        pickupPincode: pricing.shippingPickupPincode,
        deliveryPincode: pricing.shippingDeliveryPincode,
        codFeeAmount: pricing.codFee,
        actualShippingCost: null,
        actualForwardShippingCost: null,
        actualReturnShippingCost: null,
        shippingDifference: null,
        shippingReconciliationStatus: "pending_actual_courier_costs",
        paymentGatewayFee: paymentMethod === "COD" ? 0 : null,
        paymentGatewayTax: paymentMethod === "COD" ? 0 : null,
        netPaymentReceived: null,
        platformRevenue: pricing.platformRevenue,
        platformCommission: pricing.platformCommission,
        vendorSales: pricing.vendorSales,
        partswalaSales: pricing.partswalaSales,
        vendorPayables: pricing.vendorPayables,
        tcsAmount: pricing.tcsAmount,
        tdsAmount: pricing.tdsAmount,
        status,
        orderStatus: status,
        tracking: { carrier: "Shiprocket", awb: null, trackingId: null, shipmentId: null, shiprocketOrderId: null, courier: null, status, pickupStatus: null, estimatedDelivery: null },
        shippingStatus: "pending",
        shippingError: null,
        timeline: [{ status, label: "Order placed", timestamp: createdAt, note: "Order pricing was calculated and saved by the server." }],
        createdAt,
      };
      const inventoryRefs = pricing.items.map((item) => db.collection("products").doc(item.productId));
      const inventorySnapshots = await Promise.all(inventoryRefs.map((reference) => transaction.get(reference)));
      if (inventorySnapshots.some((snapshot) => !snapshot.exists)) throw new Error("A product in your cart is no longer available.");
      let reservationPlan;
      try {
        reservationPlan = planInventoryReservation(pricing.items, Object.fromEntries(inventorySnapshots.map((snapshot) => [snapshot.id, snapshot.data()?.stock])));
      } catch {
        throw new Error("A product went out of stock while your order was being created. Refresh your cart and try again.");
      }
      reservationPlan.forEach(({ productId, stock }) => {
        transaction.update(db.collection("products").doc(productId), { stock, updatedAt: createdAt });
      });
      if (couponApplication && couponCounterRef && couponUsageRef) {
        transaction.set(couponCounterRef, { usageCount: couponCounter + 1, updatedAt: createdAt }, { merge: true });
        transaction.set(couponUsageRef, { code: couponApplication.code, userId: user.uid, usageCount: couponUserUsage + 1, updatedAt: createdAt }, { merge: true });
      }
      pricing.items.forEach((item, index) => {
        if (item.sellerType !== "vendor") return;
        const settlementId = `${orderRef.id}_${index}`;
        transaction.create(db.collection("vendorSettlements").doc(settlementId), {
          orderId: orderRef.id,
          orderNumber: orderRef.id,
          productId: item.productId,
          productName: item.productName,
          vendorId: item.sellerId,
          sellerType: item.sellerType,
          sellerSubtotal: item.sellerSubtotal,
          commissionRate: item.commissionRate,
          commissionAmount: item.commissionAmount,
          platformServiceFee: item.platformServiceFee,
          vendorPayout: item.vendorPayout,
          otherDeductions: item.platformServiceFee || 0,
          paidAmount: 0,
          shippingAmount: item.shippingAmount,
          paymentGatewayFee: item.paymentGatewayFee,
          refundAmount: 0,
          tcsAmount: item.tcsAmount,
          tdsAmount: item.tdsAmount,
          settlementStatus: "pending",
          orderStatus: status,
          paymentStatus: order.paymentStatus,
          eligibleAt: null,
          createdAt,
          updatedAt: createdAt,
        });
      });
      transaction.create(orderRef, order);
      transaction.create(orderFinanceRef, {
        orderId: orderRef.id,
        partswalaProductCosts: pricing.items
          .filter((item) => item.sellerType === "partswala" && item.productCost != null)
          .map((item) => ({ productId: item.productId, unitCost: item.productCost })),
        createdAt,
      });
      transaction.create(idempotencyRef, { orderId: orderRef.id, userId: user.uid, createdAt });
      return { orderId: orderRef.id, duplicate: false, order };
    });
    return response.status(orderData.duplicate ? 200 : 201).json({ orderId: orderData.orderId, duplicate: orderData.duplicate });
  } catch (error) {
    console.error("Order creation failed:", error);
    const status = error.code === "SHIPPING_UNAVAILABLE" ? 503 : error.code ? 500 : 400;
    return response.status(status).json({ message: error.message || "Order could not be created." });
  }
});

app.post("/api/orders/returns", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  const orderId = String(request.body?.orderId || "").trim();
  const reason = String(request.body?.reason || "").trim();
  const requestedItems = Array.isArray(request.body?.items) ? request.body.items : [];
  const evidenceImages = Array.isArray(request.body?.evidenceImages) ? request.body.evidenceImages : [];
  if (!orderId || !reason || reason.length > 1000 || requestedItems.length === 0 || requestedItems.length > 20 || evidenceImages.length > 8) {
    return response.status(400).json({ message: "Provide an order, return reason, selected items, and up to eight evidence images." });
  }
  const validEvidence = evidenceImages.every((value) => {
    try {
      const url = new URL(String(value));
      return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
    } catch {
      return false;
    }
  });
  if (!validEvidence) return response.status(400).json({ message: "Evidence images must be secure Cloudinary image URLs." });

  try {
    const db = getDb();
    const orderRef = db.collection("orders").doc(orderId);
    const returnRef = db.collection("returnRequests").doc();
    const createdAt = new Date().toISOString();
    const saved = await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists || orderSnapshot.data().userId !== user.uid) throw new Error("ORDER_NOT_FOUND");
      const order = orderSnapshot.data();
      if (!["delivered", "completed"].includes(String(order.status || order.orderStatus || "").toLowerCase())) throw new Error("RETURNS_REQUIRE_DELIVERY");
      if (!["Paid", "COD collected"].includes(order.paymentStatus)) throw new Error("PAYMENT_NOT_CONFIRMED");
      if (order.returnRequestId && !["rejected", "closed"].includes(String(order.returnStatus || "").toLowerCase())) throw new Error("RETURN_ALREADY_OPEN");
      if (!isReturnWindowOpen({ ...order, returnWindowDays: normalizeReturnWindowDays(order.returnWindowDays) })) throw new Error("RETURN_WINDOW_CLOSED");

      const selectedById = new Map();
      for (const entry of requestedItems) {
        const productId = String(entry?.productId || "").trim();
        const quantity = Number(entry?.quantity);
        if (!productId || !Number.isInteger(quantity) || quantity <= 0) throw new Error("INVALID_RETURN_ITEM");
        if (selectedById.has(productId)) throw new Error("DUPLICATE_RETURN_ITEM");
        selectedById.set(productId, quantity);
      }
      const matchingItems = (order.items || []).filter((item) => selectedById.has(String(item.productId)));
      if (matchingItems.length !== selectedById.size || matchingItems.some((item) => selectedById.get(String(item.productId)) > Number(item.quantity || 0))) throw new Error("INVALID_RETURN_ITEM");
      if (matchingItems.some((item) => item.returnStatus && !["rejected", "closed"].includes(String(item.returnStatus).toLowerCase()))) throw new Error("RETURN_ITEM_ALREADY_OPEN");

      const settlementRefs = matchingItems.filter((item) => item.settlementId).map((item) => db.collection("vendorSettlements").doc(item.settlementId));
      const settlementSnapshots = await Promise.all(settlementRefs.map((reference) => transaction.get(reference)));
      const settlementById = new Map(settlementSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => [snapshot.id, snapshot.data()]));
      const returnItems = matchingItems.map((item) => ({
        productId: item.productId,
        name: item.productName || item.name || "Product",
        brand: item.brand || "",
        partNumber: item.partNumber || "",
        quantity: selectedById.get(String(item.productId)),
        sellerId: item.sellerId || "partswala",
        sellerType: item.sellerType || "partswala",
        settlementId: item.settlementId || "",
        previousSettlementStatus: settlementById.get(item.settlementId)?.settlementStatus || "pending",
      }));
      const sellerIds = [...new Set(returnItems.filter((item) => item.sellerType === "vendor").map((item) => item.sellerId))];
      const returnRequest = {
        id: returnRef.id,
        orderId,
        userId: user.uid,
        reason,
        serialNumber: String(request.body?.serialNumber || "").trim().slice(0, 120),
        items: returnItems,
        evidenceImages: evidenceImages.map(String),
        status: "submitted",
        sellerIds,
        createdAt,
        updatedAt: createdAt,
      };
      const updatedItems = (order.items || []).map((item) => selectedById.has(String(item.productId))
        ? { ...item, returnRequestId: returnRef.id, returnStatus: "submitted" }
        : item);

      transaction.create(returnRef, returnRequest);
      for (const settlementSnapshot of settlementSnapshots) {
        if (settlementSnapshot.exists && settlementSnapshot.data()?.settlementStatus !== "paid") transaction.update(settlementSnapshot.ref, { settlementStatus: "held", updatedAt: createdAt });
      }
      transaction.update(orderRef, { items: updatedItems, returnRequestId: returnRef.id, returnStatus: "submitted", updatedAt: createdAt });
      return returnRequest;
    });
    return response.status(201).json({ returnRequestId: saved.id, status: saved.status });
  } catch (error) {
    const statusByMessage = {
      ORDER_NOT_FOUND: 404,
      RETURNS_REQUIRE_DELIVERY: 409,
      PAYMENT_NOT_CONFIRMED: 409,
      RETURN_ALREADY_OPEN: 409,
      RETURN_WINDOW_CLOSED: 409,
      INVALID_RETURN_ITEM: 400,
      DUPLICATE_RETURN_ITEM: 400,
      RETURN_ITEM_ALREADY_OPEN: 409,
    };
    return response.status(statusByMessage[error.message] || 500).json({ message: error.message || "Return request could not be submitted." });
  }
});

app.patch("/api/admin/returns", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const returnId = String(request.body?.returnId || "").trim();
  const status = String(request.body?.status || "").trim().toLowerCase();
  const note = String(request.body?.note || "").trim().slice(0, 1000);
  const allowedStatuses = ["under_review", "pickup_pending", "received", "approved", "rejected", "closed"];
  if (!returnId || !allowedStatuses.includes(status)) return response.status(400).json({ message: "Choose a valid return review status." });
  try {
    const db = getDb();
    const returnRef = db.collection("returnRequests").doc(returnId);
    const timestamp = new Date().toISOString();
    let refundRef = null;
    let refundProvider = "manual_cod";
    const reviewResult = await db.runTransaction(async (transaction) => {
      const returnSnapshot = await transaction.get(returnRef);
      if (!returnSnapshot.exists) throw new Error("RETURN_NOT_FOUND");
      const returnRequest = returnSnapshot.data();
      if (!canTransitionReturnStatus(returnRequest.status, status)) throw new Error("INVALID_RETURN_TRANSITION");
      const orderRef = db.collection("orders").doc(returnRequest.orderId);
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
      const inspectionRecords = status === "approved"
        ? validateReturnInspection(returnRequest.items || [], request.body?.inspections)
        : null;
      const settlementItems = status === "rejected" ? (returnRequest.items || []).filter((item) => item.settlementId) : [];
      const settlementRefs = settlementItems.map((item) => db.collection("vendorSettlements").doc(item.settlementId));
      const settlementSnapshots = await Promise.all(settlementRefs.map((reference) => transaction.get(reference)));
      const productRefs = status === "approved"
        ? inspectionRecords.map((inspection) => db.collection("products").doc(inspection.productId))
        : [];
      const productSnapshots = await Promise.all(productRefs.map((reference) => transaction.get(reference)));
      if (productSnapshots.some((snapshot) => !snapshot.exists)) throw new Error("RETURN_PRODUCT_NOT_FOUND");
      const order = orderSnapshot.data();
      if (status === "approved") {
        const pendingQuantities = order.refundPendingQuantities || {};
        const refundableItems = (order.items || []).map((item) => ({ ...item, refundedQuantity: Number(item.refundedQuantity || 0) + Number(pendingQuantities[item.productId] || 0) }));
        const refundPlan = planSelectedRefund(refundableItems, (returnRequest.items || []).map((item) => ({ productId: item.productId, quantity: item.quantity })));
        const collectedAmount = order.paymentStatus === "COD collected" ? Number(order.codCollectedAmount ?? order.grandTotal ?? 0) : Number(order.grandTotal || 0);
        const pendingAmount = Number(order.refundPendingAmount || 0);
        if (refundPlan.amount <= 0 || refundPlan.amount + Number(order.refundedAmount || 0) + pendingAmount > collectedAmount) throw new Error("RETURN_REFUND_EXCEEDS_COLLECTED_AMOUNT");
        const refundId = createHash("sha256").update(`return:${returnId}`).digest("hex");
        refundRef = db.collection("refundRequests").doc(refundId);
        refundProvider = order.paymentGateway || "manual_cod";
        const refundLines = (returnRequest.items || []).map((returnItem) => {
          const orderItem = refundableItems.find((item) => String(item.productId) === String(returnItem.productId));
          const index = refundableItems.indexOf(orderItem);
          const quantity = Number(returnItem.quantity);
          const orderedQuantity = Number(orderItem.orderedQuantity ?? orderItem.quantity);
          return {
            productId: orderItem.productId,
            name: orderItem.name || orderItem.productName || returnItem.name,
            quantity,
            sellerId: orderItem.sellerId || "partswala",
            sellerType: orderItem.sellerType || "partswala",
            settlementId: orderItem.settlementId || null,
            lineRefundAmount: refundPlan.allocations[index],
            unitPrice: orderItem.unitPrice ?? orderItem.price,
            discount: Number((Number(orderItem.discount || 0) * quantity / orderedQuantity).toFixed(2)),
            taxableValue: Number(((Number(orderItem.originalTaxableValue ?? orderItem.taxableValue ?? orderItem.sellerSubtotal ?? 0) * quantity) / orderedQuantity).toFixed(2)),
            gstRate: orderItem.gstRate,
            cgst: Number(((Number(orderItem.originalCgst ?? orderItem.cgst ?? 0) * quantity) / orderedQuantity).toFixed(2)),
            sgst: Number(((Number(orderItem.originalSgst ?? orderItem.sgst ?? 0) * quantity) / orderedQuantity).toFixed(2)),
            igst: Number(((Number(orderItem.originalIgst ?? orderItem.igst ?? 0) * quantity) / orderedQuantity).toFixed(2)),
            taxAmount: Number(((Number(orderItem.originalTaxAmount ?? orderItem.taxAmount ?? orderItem.gstTotal ?? 0) * quantity) / orderedQuantity).toFixed(2)),
            commissionAmount: Number(((Number(orderItem.originalCommissionAmount ?? orderItem.commissionAmount ?? 0) * quantity) / orderedQuantity).toFixed(2)),
            vendorPayout: Number(((Number(orderItem.originalVendorPayout ?? orderItem.vendorPayout ?? 0) * quantity) / orderedQuantity).toFixed(2)),
          };
        });
        transaction.create(refundRef, { refundRequestId: refundId, orderId: orderRef.id, userId: order.userId, requestedBy: user.uid, provider: refundProvider, paymentId: order.paymentId || null, invoiceNumber: order.invoiceNumber, amount: refundPlan.amount, items: refundLines, reason: returnRequest.reason, returnRequestId: returnRef.id, status: "refund_requested", createdAt: timestamp, updatedAt: timestamp });
        const nextPendingQuantities = { ...pendingQuantities };
        refundLines.forEach((item) => { nextPendingQuantities[item.productId] = Number(nextPendingQuantities[item.productId] || 0) + item.quantity; });
        transaction.update(orderRef, { refundPendingAmount: Number((pendingAmount + refundPlan.amount).toFixed(2)), refundPendingQuantities: nextPendingQuantities });
        const refundCreditId = `${refundId}_${createHash("sha256").update("seller-credit-notes").digest("hex").slice(0, 8)}`;
        const groups = new Map();
        refundLines.forEach((item) => {
          const key = `${item.sellerType}:${item.sellerId}`;
          const group = groups.get(key) || [];
          group.push(item);
          groups.set(key, group);
        });
        for (const [sellerKey, lines] of groups) {
          const creditNoteId = `${refundCreditId}_${createHash("sha256").update(sellerKey).digest("hex").slice(0, 10)}`;
          const firstLine = lines[0];
          const originalItem = order.items.find((item) => item.productId === firstLine.productId);
          transaction.create(db.collection("creditNotes").doc(creditNoteId), { creditNoteId, originalInvoiceId: originalItem?.sellerInvoiceNumber || order.invoiceNumber, orderId: orderRef.id, sellerId: firstLine.sellerId, sellerType: firstLine.sellerType, reason: returnRequest.reason, items: lines, taxableAmount: Number(lines.reduce((sum, item) => sum + item.taxableValue, 0).toFixed(2)), gst: Number(lines.reduce((sum, item) => sum + item.taxAmount, 0).toFixed(2)), refundAmount: Number(lines.reduce((sum, item) => sum + item.lineRefundAmount, 0).toFixed(2)), createdAt: timestamp, status: "refund_requested", accountingReview: "CA_REVIEW_REQUIRED", refundRequestId: refundId });
        }
      }
      const released = new Map(settlementSnapshots.filter((snapshot) => snapshot.exists).map((snapshot, index) => [settlementItems[index].settlementId, settlementItems[index].previousSettlementStatus || "pending"]));
      const inspectionByProduct = new Map((inspectionRecords || []).map((inspection) => [inspection.productId, inspection]));
      const items = (order.items || []).map((item) => item.returnRequestId === returnId
        ? { ...item, returnStatus: status, ...(inspectionByProduct.has(String(item.productId)) ? { returnInspection: inspectionByProduct.get(String(item.productId)) } : {}), ...(status === "rejected" && item.settlementId ? { settlementStatus: released.get(item.settlementId) || item.settlementStatus } : {}) }
        : item);
      transaction.update(returnRef, { status, adminNote: note, reviewedBy: user.uid, reviewedAt: timestamp, ...(inspectionRecords ? { inspections: inspectionRecords, inspectedBy: user.uid, inspectedAt: timestamp } : {}), ...(refundRef ? { refundRequestId: refundRef.id, refundProvider } : {}), updatedAt: timestamp });
      inspectionRecords?.forEach((inspection, index) => {
        const productSnapshot = productSnapshots[index];
        const product = productSnapshot.data();
        const stock = Number(product.stock);
        if (!Number.isInteger(stock) || stock < 0) throw new Error("RETURN_PRODUCT_STOCK_INVALID");
        if (inspection.condition === "RESELLABLE") {
          transaction.update(productSnapshot.ref, { stock: stock + inspection.quantity, updatedAt: timestamp });
          return;
        }
        const quarantinedStock = Number(product.quarantinedStock || 0);
        if (!Number.isInteger(quarantinedStock) || quarantinedStock < 0) throw new Error("RETURN_QUARANTINE_STOCK_INVALID");
        transaction.update(productSnapshot.ref, { quarantinedStock: quarantinedStock + inspection.quantity, updatedAt: timestamp });
      });
      if (status === "rejected") {
        settlementSnapshots.forEach((snapshot, index) => {
          if (snapshot.exists && snapshot.data()?.settlementStatus !== "paid") transaction.update(snapshot.ref, { settlementStatus: settlementItems[index].previousSettlementStatus || "pending", updatedAt: timestamp });
        });
      }
      transaction.update(orderRef, { items, returnStatus: status, updatedAt: timestamp });
      stageAdminAudit(transaction, db, user, { action: inspectionRecords ? "return_inspected" : "return_decision_changed", entityType: "returnRequest", entityId: returnRef.id, oldValue: { status: returnRequest.status }, newValue: { status, inspections: inspectionRecords?.map(({ productId, quantity, condition }) => ({ productId, quantity, condition })) || null }, reason: note, timestamp });
      return { status, refundRequested: Boolean(refundRef), refundRequestId: refundRef?.id || null };
    });
    if (reviewResult.refundRequested && refundProvider !== "manual_cod") await submitProviderRefund(db, refundRef);
    return response.json({ ok: true, ...reviewResult });
  } catch (error) {
    const statusCode = ["RETURN_NOT_FOUND", "ORDER_NOT_FOUND", "RETURN_PRODUCT_NOT_FOUND"].includes(error.message) ? 404 : ["INVALID_RETURN_TRANSITION", "RETURN_REFUND_EXCEEDS_COLLECTED_AMOUNT"].includes(error.message) ? 409 : error.message.startsWith("Return inspection") || error.message.startsWith("Inspection photos") || error.message.includes("stock") ? 400 : 500;
    return response.status(statusCode).json({ message: error.message || "Return review could not be saved." });
  }
});

function normalizePickupLocation(payload, existing, vendorId) {
  return normalizeVendorPickupLocation(payload, existing, vendorId);
}

app.get("/api/vendor/pickup-location", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  try {
    const snapshot = await getDb().collection("users").doc(user.uid).get();
    if (!snapshot.exists || snapshot.data()?.role !== "vendor" || snapshot.data()?.vendorStatus !== "approved") return response.status(403).json({ message: "Approved vendor access is required." });
    return response.json({ pickupLocation: snapshot.data()?.vendorProfile?.pickupLocation || null });
  } catch (error) {
    return response.status(500).json({ message: error.message || "Pickup location could not be loaded." });
  }
});

app.put("/api/vendor/pickup-location", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  try {
    const db = getDb();
    const userRef = db.collection("users").doc(user.uid);
    const timestamp = new Date().toISOString();
    let pickupLocation;
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists || snapshot.data()?.role !== "vendor" || snapshot.data()?.vendorStatus !== "approved") throw new Error("VENDOR_NOT_APPROVED");
      const profile = snapshot.data()?.vendorProfile || {};
      const oldPickupLocation = profile.pickupLocation || null;
      pickupLocation = { ...normalizePickupLocation(request.body, oldPickupLocation, user.uid), updatedAt: timestamp };
      transaction.update(userRef, { vendorProfile: { ...profile, pickupLocation } });
      stageAdminAudit(transaction, db, user, { action: "vendor_pickup_updated", entityType: "vendor", entityId: user.uid, oldValue: oldPickupLocation, newValue: pickupLocation, reason: String(request.body?.reason || ""), timestamp });
    });
    return response.json({ pickupLocation });
  } catch (error) {
    return response.status(error.message.startsWith("Complete") ? 400 : error.message === "VENDOR_NOT_APPROVED" ? 403 : 500).json({ message: error.message || "Pickup location could not be saved." });
  }
});

app.get("/api/admin/pickup-locations", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  try {
    const snapshot = await getDb().collection("users").where("role", "==", "vendor").get();
    return response.json({ pickupLocations: snapshot.docs.map((document) => ({ vendorId: document.id, vendorName: document.data()?.vendorProfile?.businessName || document.data()?.displayName || "Vendor", pickupLocation: document.data()?.vendorProfile?.pickupLocation || null })).filter((entry) => entry.pickupLocation) });
  } catch (error) {
    return response.status(500).json({ message: error.message || "Pickup locations could not be loaded." });
  }
});

app.patch("/api/admin/pickup-locations", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const vendorId = String(request.body?.vendorId || "").trim();
  if (!vendorId) return response.status(400).json({ message: "vendorId is required." });
  try {
    const db = getDb();
    const userRef = db.collection("users").doc(vendorId);
    const timestamp = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(userRef);
      if (!snapshot.exists || !snapshot.data()?.vendorProfile?.pickupLocation) throw new Error("PICKUP_LOCATION_NOT_FOUND");
      const current = snapshot.data().vendorProfile;
      const oldPickup = current.pickupLocation;
      const pickupLocation = { ...oldPickup, isActive: request.body?.isActive === true, updatedAt: timestamp };
      transaction.update(userRef, { vendorProfile: { ...current, pickupLocation } });
      stageAdminAudit(transaction, db, user, { action: pickupLocation.isActive ? "vendor_pickup_enabled" : "vendor_pickup_disabled", entityType: "vendor", entityId: vendorId, oldValue: oldPickup, newValue: pickupLocation, reason: String(request.body?.reason || ""), timestamp });
    });
    return response.json({ ok: true, isActive: request.body?.isActive === true });
  } catch (error) {
    return response.status(error.message === "PICKUP_LOCATION_NOT_FOUND" ? 404 : 500).json({ message: error.message || "Pickup location could not be updated." });
  }
});

app.put("/api/admin/coupons", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const code = String(request.body?.code || "").trim().toUpperCase();
  const campaign = request.body?.campaign;
  if (!/^[A-Z0-9_-]{3,32}$/.test(code) || !campaign || typeof campaign !== "object") return response.status(400).json({ message: "Provide a valid coupon code and campaign." });
  try {
    const type = String(campaign.type || "").toLowerCase();
    const value = Number(campaign.value);
    const maxDiscount = campaign.maximumDiscount == null || campaign.maximumDiscount === "" ? null : Number(campaign.maximumDiscount);
    const minimumOrderAmount = Number(campaign.minimumOrderAmount || 0);
    const limits = [campaign.globalUsageLimit, campaign.perUserUsageLimit].filter((limit) => limit != null && limit !== "").map(Number);
    if (!["fixed", "percentage"].includes(type) || !Number.isFinite(value) || value <= 0 || (type === "percentage" && value > 100) || (maxDiscount != null && (!Number.isFinite(maxDiscount) || maxDiscount < 0)) || !Number.isFinite(minimumOrderAmount) || minimumOrderAmount < 0 || limits.some((limit) => !Number.isInteger(limit) || limit < 1)) return response.status(400).json({ message: "Coupon values, limits, or discount type are invalid." });
    const startsAt = campaign.startsAt ? new Date(campaign.startsAt) : null;
    const expiresAt = campaign.expiresAt ? new Date(campaign.expiresAt) : null;
    if ((startsAt && !Number.isFinite(startsAt.getTime())) || (expiresAt && !Number.isFinite(expiresAt.getTime())) || (startsAt && expiresAt && startsAt > expiresAt)) return response.status(400).json({ message: "Coupon dates are invalid." });
    const normalized = {
      active: campaign.active !== false,
      type,
      value,
      startsAt: startsAt?.toISOString() || null,
      expiresAt: expiresAt?.toISOString() || null,
      minimumOrderAmount,
      maximumDiscount: maxDiscount,
      globalUsageLimit: campaign.globalUsageLimit == null || campaign.globalUsageLimit === "" ? null : Number(campaign.globalUsageLimit),
      perUserUsageLimit: campaign.perUserUsageLimit == null || campaign.perUserUsageLimit === "" ? null : Number(campaign.perUserUsageLimit),
      eligibleProductIds: Array.isArray(campaign.eligibleProductIds) ? campaign.eligibleProductIds.map(String).slice(0, 100) : [],
      eligibleCategories: Array.isArray(campaign.eligibleCategories) ? campaign.eligibleCategories.map(String).slice(0, 100) : [],
      sellerIds: Array.isArray(campaign.sellerIds) ? campaign.sellerIds.map(String).slice(0, 100) : [],
    };
    const db = getDb();
    const couponRef = db.collection("couponCampaigns").doc(code);
    const timestamp = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(couponRef);
      transaction.set(couponRef, { ...normalized, updatedAt: timestamp, createdAt: existing.exists ? existing.data()?.createdAt || timestamp : timestamp });
      stageAdminAudit(transaction, db, user, { action: "coupon_campaign_saved", entityType: "coupon", entityId: code, oldValue: existing.exists ? existing.data() : null, newValue: normalized, reason: String(request.body?.reason || ""), timestamp });
    });
    return response.json({ ok: true, code, campaign: normalized });
  } catch (error) {
    return response.status(500).json({ message: error.message || "Coupon campaign could not be saved." });
  }
});

app.delete("/api/admin/coupons/:code", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const code = String(request.params.code || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,32}$/.test(code)) return response.status(400).json({ message: "Coupon code is invalid." });
  try {
    const db = getDb();
    const couponRef = db.collection("couponCampaigns").doc(code);
    const timestamp = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const existing = await transaction.get(couponRef);
      if (!existing.exists) throw new Error("COUPON_NOT_FOUND");
      transaction.update(couponRef, { active: false, disabledAt: timestamp, disabledBy: user.uid, updatedAt: timestamp });
      stageAdminAudit(transaction, db, user, { action: "coupon_campaign_disabled", entityType: "coupon", entityId: code, oldValue: existing.data(), newValue: { active: false }, reason: String(request.body?.reason || ""), timestamp });
    });
    return response.json({ ok: true, code, active: false });
  } catch (error) {
    return response.status(error.message === "COUPON_NOT_FOUND" ? 404 : 500).json({ message: error.message || "Coupon could not be disabled." });
  }
});

function productAuditValue(product = {}) {
  return {
    name: product.name || product.title || "",
    price: Number(product.price || 0),
    mrp: Number(product.mrp || 0),
    stock: Number(product.stock || 0),
    enabled: product.enabled !== false,
    sellerId: product.sellerId || "partswala",
    sellerType: product.sellerType || "partswala",
  };
}

app.post("/api/admin/products", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const product = request.body?.product;
  if (!product || typeof product !== "object") return response.status(400).json({ message: "Product data is required." });
  try {
    const price = Number(product.price);
    const mrp = Number(product.mrp || 0);
    const stock = Number(product.stock);
    const weight = Number(product.weight);
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(mrp) || mrp < 0 || (mrp > 0 && price > mrp) || !Number.isInteger(stock) || stock < 0 || !Number.isFinite(weight) || weight <= 0) throw new Error("Price, MRP, non-negative whole stock, and positive shipping weight are required.");
    const db = getDb();
    const productRef = db.collection("products").doc();
    const costRef = db.collection("productCosts").doc(productRef.id);
    const timestamp = new Date().toISOString();
    const productData = { ...product, price, mrp, stock, weight, updatedAt: timestamp, createdAt: timestamp };
    delete productData.costPrice;
    await db.runTransaction(async (transaction) => {
      transaction.create(productRef, productData);
      if (productData.sellerType === "partswala" && request.body.costPrice != null && request.body.costPrice !== "") transaction.create(costRef, { costPrice: Number(request.body.costPrice), updatedAt: timestamp });
      stageAdminAudit(transaction, db, user, { action: "product_created", entityType: "product", entityId: productRef.id, oldValue: null, newValue: productAuditValue(productData), reason: String(request.body.reason || ""), timestamp });
    });
    return response.status(201).json({ productId: productRef.id });
  } catch (error) {
    return response.status(400).json({ message: error.message || "Product could not be created." });
  }
});

app.put("/api/admin/products/:productId", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const product = request.body?.product;
  if (!product || typeof product !== "object") return response.status(400).json({ message: "Product data is required." });
  try {
    const price = Number(product.price);
    const mrp = Number(product.mrp || 0);
    const stock = Number(product.stock);
    const weight = Number(product.weight);
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(mrp) || mrp < 0 || (mrp > 0 && price > mrp) || !Number.isInteger(stock) || stock < 0 || !Number.isFinite(weight) || weight <= 0) throw new Error("Price, MRP, non-negative whole stock, and positive shipping weight are required.");
    const db = getDb();
    const productRef = db.collection("products").doc(String(request.params.productId));
    const costRef = db.collection("productCosts").doc(productRef.id);
    const timestamp = new Date().toISOString();
    const productData = { ...product, price, mrp, stock, weight, updatedAt: timestamp };
    delete productData.costPrice;
    await db.runTransaction(async (transaction) => {
      const [productSnapshot, costSnapshot] = await Promise.all([transaction.get(productRef), transaction.get(costRef)]);
      if (!productSnapshot.exists) throw new Error("PRODUCT_NOT_FOUND");
      const oldValue = productAuditValue(productSnapshot.data());
      transaction.update(productRef, productData);
      const costPrice = request.body.costPrice;
      if (productData.sellerType === "partswala" && costPrice != null && costPrice !== "") transaction.set(costRef, { costPrice: Number(costPrice), updatedAt: timestamp });
      else if (costSnapshot.exists) transaction.delete(costRef);
      stageAdminAudit(transaction, db, user, { action: "product_updated", entityType: "product", entityId: productRef.id, oldValue, newValue: productAuditValue(productData), reason: String(request.body.reason || ""), timestamp });
    });
    return response.json({ ok: true, productId: productRef.id });
  } catch (error) {
    return response.status(error.message === "PRODUCT_NOT_FOUND" ? 404 : 400).json({ message: error.message || "Product could not be updated." });
  }
});

app.delete("/api/admin/products/:productId", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  try {
    const db = getDb();
    const productRef = db.collection("products").doc(String(request.params.productId));
    const costRef = db.collection("productCosts").doc(productRef.id);
    const timestamp = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const [productSnapshot, costSnapshot] = await Promise.all([transaction.get(productRef), transaction.get(costRef)]);
      if (!productSnapshot.exists) throw new Error("PRODUCT_NOT_FOUND");
      transaction.delete(productRef);
      if (costSnapshot.exists) transaction.delete(costRef);
      stageAdminAudit(transaction, db, user, { action: "product_deleted", entityType: "product", entityId: productRef.id, oldValue: productAuditValue(productSnapshot.data()), newValue: null, reason: String(request.body?.reason || ""), timestamp });
    });
    return response.json({ ok: true });
  } catch (error) {
    return response.status(error.message === "PRODUCT_NOT_FOUND" ? 404 : 500).json({ message: error.message || "Product could not be deleted." });
  }
});

app.patch("/api/admin/products/:productId/enabled", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  try {
    const db = getDb();
    const productRef = db.collection("products").doc(String(request.params.productId));
    const timestamp = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(productRef);
      if (!snapshot.exists) throw new Error("PRODUCT_NOT_FOUND");
      const enabled = request.body?.enabled === true;
      transaction.update(productRef, { enabled, status: enabled ? "Available" : "Disabled", updatedAt: timestamp });
      stageAdminAudit(transaction, db, user, { action: enabled ? "product_enabled" : "product_disabled", entityType: "product", entityId: productRef.id, oldValue: { enabled: snapshot.data().enabled !== false }, newValue: { enabled }, reason: String(request.body.reason || ""), timestamp });
    });
    return response.json({ ok: true });
  } catch (error) {
    return response.status(error.message === "PRODUCT_NOT_FOUND" ? 404 : 500).json({ message: error.message || "Product status could not be updated." });
  }
});

app.patch("/api/admin/vendor-submissions/:submissionId", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const status = String(request.body?.status || "").toLowerCase();
  if (!["approved", "rejected"].includes(status)) return response.status(400).json({ message: "Choose approved or rejected." });
  const reason = String(request.body?.reason || "").trim().slice(0, 1000);
  if (status === "rejected" && !reason) return response.status(400).json({ message: "A rejection reason is required." });
  try {
    const db = getDb();
    const submissionRef = db.collection("sellerSubmissions").doc(String(request.params.submissionId));
    const timestamp = new Date().toISOString();
    const result = await db.runTransaction(async (transaction) => {
      const submissionSnapshot = await transaction.get(submissionRef);
      if (!submissionSnapshot.exists || String(submissionSnapshot.data()?.status).toLowerCase() !== "pending") throw new Error("SUBMISSION_NOT_PENDING");
      const data = submissionSnapshot.data();
      if (status === "rejected") {
        transaction.update(submissionRef, { status, rejectionReason: reason, reviewedBy: user.uid, reviewedAt: timestamp, reviewHistory: [...(data.reviewHistory || []), { status, reason, reviewedBy: user.uid, reviewedAt: timestamp }] });
        stageAdminAudit(transaction, db, user, { action: "vendor_submission_rejected", entityType: "sellerSubmission", entityId: submissionRef.id, oldValue: { status: data.status }, newValue: { status, reason }, reason, timestamp });
        return { status };
      }
      const vendorRef = db.collection("users").doc(String(data.sellerId));
      const vendorSnapshot = await transaction.get(vendorRef);
      if (!vendorSnapshot.exists || vendorSnapshot.data()?.role !== "vendor" || vendorSnapshot.data()?.vendorStatus !== "approved") throw new Error("VENDOR_NOT_APPROVED");
      const settingsSnapshot = await transaction.get(db.doc("settings/store"));
      const settings = settingsSnapshot.data() || {};
      if (!Number.isFinite(Number(data.weight)) || Number(data.weight) <= 0 || Number(data.gstRate) !== Number(settings.productGstRate ?? 18) || !Array.isArray(data.images) || data.images.length === 0) throw new Error("SUBMISSION_INVALID");
      const vendorPickupLocation = vendorSnapshot.data()?.vendorProfile?.pickupLocation || null;
      if (!hasValidVendorPickupLocation(vendorPickupLocation)) throw new Error("VENDOR_PICKUP_LOCATION_REQUIRED");
      const existingProductId = String(data.existingProductId || "").trim();
      const productRef = existingProductId ? db.collection("products").doc(existingProductId) : db.collection("products").doc();
      const existingProductSnapshot = existingProductId ? await transaction.get(productRef) : null;
      if (existingProductId && (!existingProductSnapshot?.exists || existingProductSnapshot.data()?.sellerId !== data.sellerId || existingProductSnapshot.data()?.sellerType !== "vendor")) throw new Error("PRODUCT_NOT_OWNED_BY_VENDOR");
      const vendor = vendorSnapshot.data();
      const product = {
        name: data.name,
        description: data.description || "",
        category: data.category || "Other Parts",
        brand: data.brand || "",
        partNumber: data.partNumber || "",
        price: Number(data.price || 0),
        mrp: Number(data.mrp || 0),
        stock: Number(data.stock || 0),
        hsn: data.hsn || "",
        gstRate: Number(settings.productGstRate ?? 18),
        priceIncludesGst: settings.pricesIncludeGst !== false,
        compatibility: data.compatibility || "",
        weight: Number(data.weight),
        dimensions: data.dimensions || { length: 0, width: 0, height: 0 },
        sellerId: data.sellerId,
        sellerType: "vendor",
        vendorName: vendor.vendorProfile?.businessName || vendor.displayName || "Vendor",
        images: data.images,
        imageUrl: data.imageUrl || data.images[0] || "",
        enabled: true,
        status: "Available",
        createdAt: existingProductSnapshot?.data()?.createdAt || timestamp,
        updatedAt: timestamp,
      };
      if (existingProductSnapshot?.exists) transaction.update(productRef, product);
      else transaction.create(productRef, product);
      transaction.set(db.collection("vendorProductLinks").doc(submissionRef.id), { productId: productRef.id, vendorId: data.sellerId, vendorName: product.vendorName, submissionId: submissionRef.id, approvedBy: user.uid, approvedAt: timestamp });
      transaction.update(submissionRef, { status, approvedProductId: productRef.id, approvedBy: user.uid, reviewedBy: user.uid, reviewedAt: timestamp, rejectionReason: "", reviewHistory: [...(data.reviewHistory || []), { status, reviewedBy: user.uid, reviewedAt: timestamp }] });
      stageAdminAudit(transaction, db, user, { action: "vendor_product_published", entityType: "product", entityId: productRef.id, oldValue: existingProductSnapshot?.exists ? productAuditValue(existingProductSnapshot.data()) : null, newValue: productAuditValue(product), reason: `Approved vendor submission ${submissionRef.id}`, timestamp });
      return { status, productId: productRef.id };
    });
    return response.json(result);
  } catch (error) {
    const statusCode = error.message === "SUBMISSION_NOT_PENDING" ? 409 : ["VENDOR_NOT_APPROVED", "PRODUCT_NOT_OWNED_BY_VENDOR"].includes(error.message) ? 403 : ["SUBMISSION_INVALID", "VENDOR_PICKUP_LOCATION_REQUIRED"].includes(error.message) ? 400 : 500;
    return response.status(statusCode).json({ message: error.message || "Vendor submission review failed." });
  }
});

app.patch("/api/admin/vendor-applications/:vendorId", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const status = String(request.body?.status || "").toLowerCase();
  const reason = String(request.body?.reason || "").trim().slice(0, 1000);
  if (!["approved", "rejected"].includes(status) || (status === "rejected" && !reason)) return response.status(400).json({ message: "Choose a valid decision and provide a rejection reason." });
  try {
    const db = getDb();
    const vendorId = String(request.params.vendorId);
    const applicationRef = db.collection("vendorApplications").doc(vendorId);
    const userRef = db.collection("users").doc(vendorId);
    const timestamp = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const [applicationSnapshot, userSnapshot] = await Promise.all([transaction.get(applicationRef), transaction.get(userRef)]);
      if (!applicationSnapshot.exists || applicationSnapshot.data()?.status !== "pending") throw new Error("APPLICATION_NOT_PENDING");
      const application = applicationSnapshot.data();
      const oldUser = userSnapshot.exists ? userSnapshot.data() : {};
      transaction.update(applicationRef, { status, reviewedAt: timestamp, reviewedBy: user.uid, rejectionReason: status === "rejected" ? reason : "" });
      if (status === "approved") transaction.set(userRef, { role: "vendor", vendorStatus: "approved", vendorApprovedAt: timestamp, vendorApprovedBy: user.uid, vendorProfile: { businessName: application.businessName, ownerName: application.ownerName, email: application.email, phone: application.phone, businessAddress: application.businessAddress, city: application.city, state: application.state, pincode: application.pincode, gstin: application.gstin || "", pan: application.pan || "" } }, { merge: true });
      else transaction.set(userRef, { vendorStatus: "rejected" }, { merge: true });
      stageAdminAudit(transaction, db, user, { action: status === "approved" ? "vendor_enabled" : "vendor_disabled", entityType: "vendor", entityId: vendorId, oldValue: { role: oldUser.role || null, vendorStatus: oldUser.vendorStatus || null }, newValue: { role: status === "approved" ? "vendor" : oldUser.role || null, vendorStatus: status }, reason, timestamp });
    });
    return response.json({ ok: true, status });
  } catch (error) {
    return response.status(error.message === "APPLICATION_NOT_PENDING" ? 409 : 500).json({ message: error.message || "Vendor application review failed." });
  }
});

app.put("/api/admin/settings/store", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const supplied = request.body?.settings;
  if (!supplied || typeof supplied !== "object") return response.status(400).json({ message: "Store settings are required." });
  const percentageFields = ["vendorCommissionRate", "platformServiceFeeRate", "vendorGatewayFeeShareRate"];
  const percentagesValid = percentageFields.every((field) => Number.isFinite(Number(supplied[field] ?? (field === "vendorCommissionRate" ? 10 : 0))) && Number(supplied[field] ?? (field === "vendorCommissionRate" ? 10 : 0)) >= 0 && Number(supplied[field] ?? (field === "vendorCommissionRate" ? 10 : 0)) <= 100);
  const amountFields = ["shippingFee", "freeShippingThreshold", "codFee"];
  const amountsValid = amountFields.every((field) => Number.isFinite(Number(supplied[field] ?? 0)) && Number(supplied[field] ?? 0) >= 0);
  if (!percentagesValid || !amountsValid || !["absorb", "pass_through", "retain"].includes(String(supplied.shippingDifferencePolicy || "absorb")) || !["taxable", "non_taxable"].includes(String(supplied.shippingTaxTreatment || "")) || !["taxable", "non_taxable"].includes(String(supplied.codFeeTaxTreatment || ""))) {
    return response.status(400).json({ message: "Commission, shipping, GST, COD and tax-policy settings must use valid configured values." });
  }
  const settings = {
    ...supplied,
    businessState: String(supplied.businessState || "").trim(),
    pickupPincode: String(supplied.pickupPincode || "").trim(),
    vendorCommissionRate: Number(supplied.vendorCommissionRate ?? 10),
    platformServiceFeeRate: Number(supplied.platformServiceFeeRate ?? 0),
    vendorGatewayFeeShareRate: Number(supplied.vendorGatewayFeeShareRate ?? 0),
    shippingFee: Number(supplied.shippingFee || 0),
    freeShippingThreshold: Number(supplied.freeShippingThreshold || 0),
    codFee: Number(supplied.codFee || 0),
  };
  const db = getDb();
  const settingsRef = db.doc("settings/store");
  const timestamp = new Date().toISOString();
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(settingsRef);
    const oldValue = snapshot.exists ? snapshot.data() : null;
    transaction.set(settingsRef, { ...settings, updatedAt: timestamp }, { merge: true });
    stageAdminAudit(transaction, db, user, { action: "store_finance_shipping_settings_changed", entityType: "storeSettings", entityId: "store", oldValue, newValue: settings, reason: String(request.body.reason || ""), timestamp });
  });
  return response.json({ ok: true });
});

app.get("/api/vendor/dashboard", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  try {
    const db = getDb();
    const vendorSnapshot = await db.collection("users").doc(user.uid).get();
    const vendor = vendorSnapshot.data();
    if (isAdminUser(user) || !vendorSnapshot.exists || vendor?.role !== "vendor" || vendor?.vendorStatus !== "approved") {
      return response.status(403).json({ message: "Approved vendor access is required." });
    }

    const [productSnapshot, linkSnapshot, settlementSnapshot, settingsSnapshot] = await Promise.all([
      db.collection("products").where("sellerId", "==", user.uid).get(),
      db.collection("vendorProductLinks").where("vendorId", "==", user.uid).get(),
      db.collection("vendorSettlements").where("vendorId", "==", user.uid).get(),
      db.doc("settings/store").get(),
    ]);
    const productsById = new Map(productSnapshot.docs.map((document) => [document.id, { id: document.id, ...document.data() }]));
    const linkedProductIds = [...new Set(linkSnapshot.docs.map((document) => String(document.data().productId || "")).filter(Boolean))]
      .filter((productId) => !productsById.has(productId));
    for (let index = 0; index < linkedProductIds.length; index += 100) {
      const snapshots = await db.getAll(...linkedProductIds.slice(index, index + 100).map((productId) => db.collection("products").doc(productId)));
      for (const document of snapshots) {
        if (!document.exists) continue;
        const product = document.data();
        if (product.sellerId && product.sellerId !== user.uid) continue;
        productsById.set(document.id, { id: document.id, ...product, sellerId: user.uid, sellerType: "vendor" });
      }
    }
    const products = [...productsById.values()].map((product) => ({
      id: product.id,
      name: product.name || product.title || "",
      description: product.description || "",
      brand: product.brand || "",
      partNumber: product.partNumber || "",
      category: product.category || "",
      price: product.price != null && Number.isFinite(Number(product.price)) ? Number(product.price) : null,
      mrp: product.mrp != null && Number.isFinite(Number(product.mrp)) ? Number(product.mrp) : null,
      stock: product.stock != null && Number.isFinite(Number(product.stock)) ? Number(product.stock) : null,
      compatibility: product.compatibility || "",
      weight: product.weight != null && Number.isFinite(Number(product.weight)) ? Number(product.weight) : null,
      dimensions: product.dimensions || {},
      images: Array.isArray(product.images) ? product.images : product.imageUrl ? [product.imageUrl] : [],
      imageUrl: product.imageUrl || product.images?.[0] || "",
      enabled: product.enabled !== false && String(product.status || "").toLowerCase() !== "disabled",
      status: product.status || (product.enabled === false ? "Disabled" : "Available"),
    }));

    const settlements = settlementSnapshot.docs.map((document) => {
      const row = document.data();
      return {
        id: document.id,
        orderId: row.orderId || "",
        productId: row.productId || "",
        productName: row.productName || "",
        sellerSubtotal: Number(row.sellerSubtotal || 0),
        commissionRate: Number(row.commissionRate ?? 10),
        commissionAmount: Number(row.commissionAmount || 0),
        vendorPayout: Number(row.vendorPayout || 0),
        paidAmount: Number(row.paidAmount || 0),
        otherDeductions: Number(row.otherDeductions || 0),
        settlementStatus: settlementStatusFor({
          orderStatus: row.orderStatus,
          paymentStatus: row.paymentStatus,
          eligibleAt: row.eligibleAt,
          currentStatus: row.settlementStatus,
        }),
        orderStatus: row.orderStatus || "pending",
        paymentStatus: row.paymentStatus || "Pending",
        refundAmount: Number(row.refundAmount || 0),
        createdAt: row.createdAt || "",
      };
    });
    const orderIds = [...new Set(settlements.map((settlement) => settlement.orderId).filter(Boolean))];
    const orderSnapshots = [];
    for (let index = 0; index < orderIds.length; index += 100) {
      orderSnapshots.push(...await db.getAll(...orderIds.slice(index, index + 100).map((orderId) => db.collection("orders").doc(orderId))));
    }
    const settlementByKey = new Map(settlements.map((settlement) => [`${settlement.orderId}:${settlement.productId}`, settlement]));
    const orders = orderSnapshots.filter((snapshot) => snapshot.exists).map((snapshot) => {
      const order = snapshot.data();
      const items = (order.items || []).filter((item) => item.sellerType === "vendor" && item.sellerId === user.uid).map((item) => {
        const settlement = settlementByKey.get(`${snapshot.id}:${item.productId}`);
        return {
          productId: item.productId || "",
          name: item.productName || item.name || settlement?.productName || "Vendor product",
          quantity: Number(item.quantity || 0),
          sellerSubtotal: Number(settlement?.sellerSubtotal ?? item.sellerSubtotal ?? 0),
          commissionAmount: Number(settlement?.commissionAmount ?? item.commissionAmount ?? 0),
          vendorPayout: Number(settlement?.vendorPayout ?? item.vendorPayout ?? 0),
          settlementStatus: settlement?.settlementStatus || item.settlementStatus || "pending",
          refundAmount: Number(settlement?.refundAmount ?? item.refundAmount ?? 0),
        };
      });
      if (!items.length) return null;
      const statuses = new Set(items.map((item) => item.settlementStatus));
      return {
        id: snapshot.id,
        orderId: snapshot.id,
        createdAt: order.createdAt || "",
        customerName: order.customerName || order.customer?.fullName || "",
        status: order.status || order.orderStatus || "pending",
        paymentStatus: order.paymentStatus || "Pending",
        refundStatus: order.refundStatus || "none",
        items,
        productSubtotal: Number(items.reduce((sum, item) => sum + item.sellerSubtotal, 0).toFixed(2)),
        vendorPayout: Number(items.reduce((sum, item) => sum + item.vendorPayout, 0).toFixed(2)),
        commissionAmount: Number(items.reduce((sum, item) => sum + item.commissionAmount, 0).toFixed(2)),
        settlementStatus: statuses.size === 1 ? [...statuses][0] : statuses.has("held") ? "held" : "pending",
      };
    }).filter(Boolean).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));

    const activeOrders = orders.filter((order) => String(order.status).toLowerCase() !== "cancelled");
    const currentMonth = new Date().toISOString().slice(0, 7);
    const payoutTotal = (statuses) => Number(settlements.filter((row) => statuses.includes(row.settlementStatus)).reduce((sum, row) => sum + row.vendorPayout, 0).toFixed(2));
    const paidAmount = Number(settlements.filter((row) => row.settlementStatus === "paid" || row.paidAmount > 0).reduce((sum, row) => sum + row.paidAmount, 0).toFixed(2));
    const activeProducts = products.filter((product) => product.enabled).length;
    const storeSettings = settingsSnapshot.exists ? settingsSnapshot.data() : {};
    const commissionRate = storeSettings.vendorCommissionRate;

    return response.json({
      vendor: {
        name: vendor.vendorProfile?.businessName || vendor.displayName || user.name || "Vendor",
        gstRate: Number(storeSettings.productGstRate ?? 18),
        commissionRate: commissionRate != null && Number.isFinite(Number(commissionRate)) ? Number(commissionRate) : 10,
      },
      products,
      orders,
      settlements,
      metrics: {
        totalProducts: products.length,
        activeProducts,
        totalOrders: new Set(activeOrders.map((order) => order.id)).size,
        pendingOrders: activeOrders.filter((order) => ["pending", "confirmed"].includes(String(order.status).toLowerCase())).length,
        deliveredOrders: activeOrders.filter((order) => ["delivered", "completed"].includes(String(order.status).toLowerCase())).length,
        returnOrders: activeOrders.filter((order) => ["return_requested", "returned", "partial"].includes(String(order.status).toLowerCase()) || order.refundStatus === "partial" || order.refundStatus === "refunded").length,
        totalSales: Number(settlements.filter((row) => row.orderStatus !== "cancelled").reduce((sum, row) => sum + row.sellerSubtotal, 0).toFixed(2)),
        monthSales: Number(settlements.filter((row) => row.orderStatus !== "cancelled" && row.createdAt.startsWith(currentMonth)).reduce((sum, row) => sum + row.sellerSubtotal, 0).toFixed(2)),
        commissionCharged: Number(settlements.reduce((sum, row) => sum + row.commissionAmount, 0).toFixed(2)),
        refundAdjustments: Number(settlements.reduce((sum, row) => sum + row.refundAmount, 0).toFixed(2)),
        unitsSold: activeOrders.reduce((sum, order) => sum + order.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0),
        pendingPayouts: payoutTotal(["pending", "held"]),
        availableBalance: payoutTotal(["payable"]),
        pendingBalance: payoutTotal(["pending", "held"]),
        paidAmount,
        payableAmount: payoutTotal(["payable"]),
      },
    });
  } catch (error) {
    console.error("Vendor dashboard could not be loaded:", error);
    return response.status(500).json({ message: "Vendor dashboard data could not be loaded." });
  }
});

app.get("/api/vendor/finance", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  try {
    const db = getDb();
    const vendorSnapshot = await db.collection("users").doc(user.uid).get();
    if (!vendorSnapshot.exists || vendorSnapshot.data().role !== "vendor" || vendorSnapshot.data().vendorStatus !== "approved") {
      return response.status(403).json({ message: "Approved vendor access is required." });
    }
    const snapshot = await db.collection("vendorSettlements").where("vendorId", "==", user.uid).get();
    const settlements = snapshot.docs.map((document) => {
      const row = document.data();
      const settlementStatus = settlementStatusFor({
        orderStatus: row.orderStatus,
        paymentStatus: row.paymentStatus,
        eligibleAt: row.eligibleAt,
        currentStatus: row.settlementStatus,
      });
      return { id: document.id, ...row, settlementStatus };
    });
    const sum = (status) => Number(settlements.filter((row) => row.settlementStatus === status).reduce((total, row) => total + Number(row.vendorPayout || 0), 0).toFixed(2));
    return response.json({
      availableBalance: sum("payable"),
      pendingBalance: sum("pending") + sum("held"),
      paidBalance: Number(settlements.filter((row) => row.settlementStatus === "paid" || Number(row.paidAmount || 0) > 0).reduce((total, row) => total + Number(row.paidAmount || 0), 0).toFixed(2)),
      settlements: settlements.sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || ""))),
    });
  } catch (error) {
    console.error("Vendor finance could not be loaded:", error);
    return response.status(500).json({ message: "Vendor settlement details could not be loaded." });
  }
});

app.get("/api/admin/finance", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  try {
    const db = getDb();
    let dateRange;
    try {
      dateRange = normalizeFinanceDateRange(request.query);
    } catch (error) {
      return response.status(400).json({ message: error.message });
    }
    const pageSize = 100;
    const today = new Date().toISOString().slice(0, 10);
    const addMoney = (left, right) => Math.round((left + Number(right || 0)) * 100) / 100;
    const summary = {
      todaySales: 0, totalSales: 0, grossCollections: 0, refundsCollected: 0, taxesCollected: 0,
      vendorSales: 0, partswalaSales: 0, partswalaProductCost: 0, partswalaCostsKnown: true,
      platformCommission: 0, platformServiceRevenue: 0, shippingCollected: 0, shippingRefundAmount: 0,
      shippingRevenue: 0, actualShippingCost: 0, actualShippingCostKnown: true,
      actualShippingCostPendingOrders: 0, gatewayFees: 0, gatewayFeesKnown: true, gatewayTax: 0,
      gatewayTaxesKnown: true, refunds: 0, codFeeRefundAmount: 0, codOrders: 0, prepaidOrders: 0,
      vendorPayables: 0, tcsAmount: 0, tdsAmount: 0, orderCount: 0,
    };
    const orderDetails = [];
    let orderScanCursor = null;
    let orderDetailsCursor = null;
    while (true) {
      let query = db.collection("orders").where("createdAt", ">=", dateRange.startAt).where("createdAt", "<=", dateRange.endAt).orderBy("createdAt", "desc").limit(pageSize);
      if (orderScanCursor) query = query.startAfter(orderScanCursor);
      const page = await query.get();
      if (page.empty) break;
      orderScanCursor = page.docs.at(-1);
      summary.orderCount += page.size;
      const pageOrders = page.docs.map((document) => ({ id: document.id, ...document.data() }));
      if (!orderDetails.length) {
        orderDetails.push(...pageOrders);
        if (page.size === pageSize) orderDetailsCursor = page.docs.at(-1);
      }

      const costSnapshots = await db.getAll(...page.docs.map((document) => db.collection("orderFinance").doc(document.id)));
      const costsByOrder = new Map(costSnapshots.map((document) => [
        document.id,
        new Map((document.data()?.partswalaProductCosts || []).map((entry) => [entry.productId, entry.unitCost])),
      ]));
      const activeOrders = pageOrders.filter((order) => order.status !== "cancelled");
      const collectedOrders = activeOrders.filter((order) => ["Paid", "COD collected"].includes(order.paymentStatus));
      const items = activeOrders.flatMap((order) => (order.items || []).map((item) => {
        const { productCost: _publicProductCost, ...safeItem } = item;
        const costMap = costsByOrder.get(order.id);
        return costMap?.has(item.productId) ? { ...safeItem, productCost: costMap.get(item.productId) } : safeItem;
      }));
      const pageSum = (selector) => activeOrders.reduce((total, order) => total + Number(selector(order) || 0), 0);
      const pageGatewayFeesKnown = activeOrders.every((order) => order.paymentMethod === "COD" || (order.paymentGatewayFee != null && Number.isFinite(Number(order.paymentGatewayFee))));
      const pageGatewayTaxesKnown = activeOrders.every((order) => order.paymentMethod === "COD" || (order.paymentGatewayTax != null && Number.isFinite(Number(order.paymentGatewayTax))));
      const pageShippingKnown = activeOrders.every((order) => order.actualShippingCost != null);
      const finance = buildFinanceTotals(items, {
        shippingChargedToCustomer: pageSum((order) => order.shippingChargedToCustomer ?? order.shippingCharge),
        shippingRefundAmount: pageSum((order) => order.shippingRefundAmount),
        codFeeAmount: pageSum((order) => order.codFee),
        codFeeRefundAmount: pageSum((order) => order.codFeeRefundAmount),
        actualShippingCost: pageShippingKnown ? pageSum((order) => order.actualShippingCost) : null,
        paymentGatewayFee: pageGatewayFeesKnown ? pageSum((order) => order.paymentGatewayFee) : null,
        paymentGatewayTax: pageGatewayTaxesKnown ? pageSum((order) => order.paymentGatewayTax) : null,
        refundAmount: pageSum((order) => order.refundedAmount ?? order.refundAmount),
        shippingDifferencePolicy: "absorb",
      });
      const collectedFinance = buildFinanceTotals(collectedOrders.flatMap((order) => order.items || []), {
        shippingChargedToCustomer: collectedOrders.reduce((total, order) => total + Number(order.shippingChargedToCustomer ?? order.shippingCharge ?? 0), 0),
        shippingRefundAmount: collectedOrders.reduce((total, order) => total + Number(order.shippingRefundAmount || 0), 0),
        codFeeAmount: collectedOrders.reduce((total, order) => total + Number(order.codFee || 0), 0),
        codFeeRefundAmount: collectedOrders.reduce((total, order) => total + Number(order.codFeeRefundAmount || 0), 0),
      });
      summary.todaySales = addMoney(summary.todaySales, activeOrders.filter((order) => String(order.createdAt || "").slice(0, 10) === today).reduce((total, order) => total + Number(order.grandTotal || 0), 0));
      summary.totalSales = addMoney(summary.totalSales, activeOrders.reduce((total, order) => total + Number(order.grandTotal || 0), 0));
      summary.grossCollections = addMoney(summary.grossCollections, collectedOrders.reduce((total, order) => total + Number(order.grandTotal || order.totalAmount || 0), 0));
      summary.refundsCollected = addMoney(summary.refundsCollected, collectedOrders.reduce((total, order) => total + Number(order.refundedAmount ?? order.refundAmount ?? 0), 0));
      summary.refunds = addMoney(summary.refunds, pageSum((order) => order.refundedAmount ?? order.refundAmount));
      summary.taxesCollected = addMoney(summary.taxesCollected, collectedFinance.taxesCollected);
      summary.vendorSales = addMoney(summary.vendorSales, finance.vendorSales);
      summary.partswalaSales = addMoney(summary.partswalaSales, finance.partswalaSales);
      if (finance.partswalaProductCost == null) summary.partswalaCostsKnown = false;
      else summary.partswalaProductCost = addMoney(summary.partswalaProductCost, finance.partswalaProductCost);
      summary.platformCommission = addMoney(summary.platformCommission, finance.platformCommission);
      summary.platformServiceRevenue = addMoney(summary.platformServiceRevenue, finance.platformServiceRevenue);
      summary.shippingCollected = addMoney(summary.shippingCollected, finance.shippingCollectedNet);
      summary.shippingRefundAmount = addMoney(summary.shippingRefundAmount, finance.shippingRefundAmount);
      summary.codFeeRefundAmount = addMoney(summary.codFeeRefundAmount, finance.codFeeRefundAmount);
      summary.vendorPayables = addMoney(summary.vendorPayables, finance.vendorPayables);
      summary.tcsAmount = addMoney(summary.tcsAmount, finance.tcsAmount);
      summary.tdsAmount = addMoney(summary.tdsAmount, finance.tdsAmount);
      if (!pageShippingKnown) summary.actualShippingCostKnown = false;
      else summary.actualShippingCost = addMoney(summary.actualShippingCost, pageSum((order) => order.actualShippingCost));
      if (!pageGatewayFeesKnown) summary.gatewayFeesKnown = false;
      else summary.gatewayFees = addMoney(summary.gatewayFees, pageSum((order) => order.paymentGatewayFee));
      if (!pageGatewayTaxesKnown) summary.gatewayTaxesKnown = false;
      else summary.gatewayTax = addMoney(summary.gatewayTax, pageSum((order) => order.paymentGatewayTax));
      summary.actualShippingCostPendingOrders += pageOrders.filter((order) => order.actualShippingCost == null).length;
      summary.codOrders += activeOrders.filter((order) => order.paymentMethod === "COD").length;
      summary.prepaidOrders += activeOrders.filter((order) => order.paymentMethod !== "COD").length;
      for (const order of activeOrders) {
        const row = buildFinanceTotals(order.items || [], {
          shippingChargedToCustomer: order.shippingChargedToCustomer ?? order.shippingCharge ?? 0,
          shippingRefundAmount: order.shippingRefundAmount || 0,
          actualShippingCost: order.actualShippingCost,
          shippingDifferencePolicy: order.finance?.shippingDifferencePolicy || order.orderTotals?.shippingPolicy || "absorb",
        });
        summary.shippingRevenue = addMoney(summary.shippingRevenue, row.shippingRevenue);
      }
      if (page.size < pageSize) break;
    }

    const settlementDetails = [];
    const settlementTotals = { pending: 0, held: 0, payable: 0, paid: 0 };
    let settlementScanCursor = null;
    let settlementDetailsCursor = null;
    let settlementCount = 0;
    while (true) {
      let query = db.collection("vendorSettlements").where("createdAt", ">=", dateRange.startAt).where("createdAt", "<=", dateRange.endAt).orderBy("createdAt", "desc").limit(pageSize);
      if (settlementScanCursor) query = query.startAfter(settlementScanCursor);
      const page = await query.get();
      if (page.empty) break;
      settlementScanCursor = page.docs.at(-1);
      settlementCount += page.size;
      const rows = page.docs.map((document) => {
        const row = document.data();
        return { id: document.id, ...row, settlementStatus: settlementStatusFor({ ...row, currentStatus: row.settlementStatus }) };
      });
      if (!settlementDetails.length) {
        settlementDetails.push(...rows);
        if (page.size === pageSize) settlementDetailsCursor = page.docs.at(-1);
      }
      for (const row of rows) {
        if (row.settlementStatus === "paid" || Number(row.paidAmount || 0) > 0) settlementTotals.paid = addMoney(settlementTotals.paid, row.paidAmount);
        if (["pending", "held", "payable"].includes(row.settlementStatus)) settlementTotals[row.settlementStatus] = addMoney(settlementTotals[row.settlementStatus], row.vendorPayout);
      }
      if (page.size < pageSize) break;
    }
    const actualShippingCost = summary.actualShippingCostKnown ? summary.actualShippingCost : null;
    const platformRevenue = addMoney(addMoney(summary.platformCommission, summary.platformServiceRevenue), summary.shippingRevenue);
    return response.json({
      todaySales: summary.todaySales,
      totalSales: summary.totalSales,
      grossCustomerCollections: summary.grossCollections,
      taxesCollected: summary.taxesCollected,
      vendorSales: summary.vendorSales,
      partswalaSales: summary.partswalaSales,
      pendingVendorPayouts: addMoney(settlementTotals.pending, settlementTotals.held),
      payableVendorAmount: settlementTotals.payable,
      paidVendorAmount: settlementTotals.paid,
      platformCommission: summary.platformCommission,
      platformRevenue,
      partswalaProductCost: summary.partswalaCostsKnown ? summary.partswalaProductCost : null,
      partswalaProductMargin: summary.partswalaCostsKnown ? Number((summary.partswalaSales - summary.partswalaProductCost).toFixed(2)) : null,
      platformOperatingExpenses: null,
      platformNetResult: null,
      shippingCollected: summary.shippingCollected,
      actualShippingCost,
      actualShippingCostPendingOrders: summary.actualShippingCostPendingOrders,
      shippingDifference: actualShippingCost == null ? null : Number((summary.shippingCollected - actualShippingCost).toFixed(2)),
      shippingRevenue: summary.shippingRevenue,
      paymentGatewayFees: summary.gatewayFeesKnown ? summary.gatewayFees : null,
      paymentGatewayTax: summary.gatewayTaxesKnown ? summary.gatewayTax : null,
      refunds: summary.refunds,
      netCustomerCollections: Number((summary.grossCollections - summary.refundsCollected).toFixed(2)),
      codOrders: summary.codOrders,
      prepaidOrders: summary.prepaidOrders,
      tcsAmount: summary.tcsAmount,
      tdsAmount: summary.tdsAmount,
      orders: orderDetails,
      settlements: settlementDetails,
      ordersCursor: summary.orderCount > orderDetails.length ? orderDetailsCursor?.id || null : null,
      settlementsCursor: settlementCount > settlementDetails.length ? settlementDetailsCursor?.id || null : null,
      summaryOrderCount: summary.orderCount,
      reportingPeriod: { startDate: dateRange.startDate, endDate: dateRange.endDate },
    });
  } catch (error) {
    console.error("Admin finance could not be loaded:", error);
    return response.status(500).json({ message: "Finance dashboard could not be loaded." });
  }
});

app.get("/api/admin/finance/details", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const db = getDb();
  const pageSize = 100;
  let dateRange;
  try {
    dateRange = normalizeFinanceDateRange(request.query);
  } catch (error) {
    return response.status(400).json({ message: error.message });
  }
  async function readPage(collectionName, cursor) {
    const collection = db.collection(collectionName);
    let query = collection.where("createdAt", ">=", dateRange.startAt).where("createdAt", "<=", dateRange.endAt).orderBy("createdAt", "desc").limit(pageSize);
    if (cursor) {
      const cursorSnapshot = await collection.doc(String(cursor)).get();
      if (cursorSnapshot.exists) query = query.startAfter(cursorSnapshot);
    }
    const page = await query.get();
    return {
      rows: page.docs.map((document) => ({ id: document.id, ...document.data() })),
      cursor: page.size === pageSize ? page.docs.at(-1).id : null,
    };
  }
  try {
    const [orders, settlements] = await Promise.all([
      readPage("orders", request.query.ordersCursor),
      readPage("vendorSettlements", request.query.settlementsCursor),
    ]);
    settlements.rows = settlements.rows.map((row) => ({ ...row, settlementStatus: settlementStatusFor({ ...row, currentStatus: row.settlementStatus }) }));
    return response.json({ orders: orders.rows, ordersCursor: orders.cursor, settlements: settlements.rows, settlementsCursor: settlements.cursor, reportingPeriod: { startDate: dateRange.startDate, endDate: dateRange.endDate } });
  } catch (error) {
    console.error("Admin finance detail page could not be loaded:", error.message || error);
    return response.status(500).json({ message: "Finance details could not be loaded." });
  }
});

app.post("/api/admin/invoices/review", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const orderId = String(request.body?.orderId || "").trim();
  const invoiceNumber = String(request.body?.invoiceNumber || "").trim();
  const reason = String(request.body?.reason || "").trim().slice(0, 1000);
  if (!orderId || !invoiceNumber || reason.length < 10) return response.status(400).json({ message: "Provide the order, invoice, and a review note of at least 10 characters." });
  try {
    const db = getDb();
    const orderRef = db.collection("orders").doc(orderId);
    const reviewedAt = new Date().toISOString();
    const result = await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
      const order = orderSnapshot.data();
      const snapshots = Array.isArray(order.sellerInvoiceSnapshots) ? order.sellerInvoiceSnapshots : [];
      const index = snapshots.findIndex((invoice) => invoice.invoiceNumber === invoiceNumber);
      if (index < 0) throw new Error("INVOICE_NOT_FOUND");
      const invoice = snapshots[index];
      if (invoice.issuerModel !== "seller_specific_snapshot_requires_accounting_review") throw new Error("INVOICE_REVIEW_NOT_REQUIRED");
      if (invoice.accountingReviewStatus === "reviewed") return { duplicate: true, accountingReviewStatus: "reviewed" };
      const reviewedInvoice = {
        ...invoice,
        accountingReviewStatus: "reviewed",
        accountingReviewedAt: reviewedAt,
      };
      const nextSnapshots = [...snapshots];
      nextSnapshots[index] = reviewedInvoice;
      transaction.update(orderRef, { sellerInvoiceSnapshots: nextSnapshots, updatedAt: reviewedAt });
      stageAdminAudit(transaction, db, user, {
        action: "seller_invoice_accounting_reviewed",
        entityType: "sellerInvoice",
        entityId: invoiceNumber,
        oldValue: { accountingReviewStatus: invoice.accountingReviewStatus || "pending" },
        newValue: { accountingReviewStatus: "reviewed", reviewedBy: user.uid },
        reason,
        timestamp: reviewedAt,
      });
      return { duplicate: false, accountingReviewStatus: "reviewed", reviewedAt };
    });
    return response.json({ ok: true, ...result });
  } catch (error) {
    const status = error.message === "ORDER_NOT_FOUND" || error.message === "INVOICE_NOT_FOUND" ? 404
      : error.message === "INVOICE_REVIEW_NOT_REQUIRED" ? 409
        : 500;
    return response.status(status).json({ message: error.message || "Invoice review could not be recorded." });
  }
});

app.post("/api/admin/finance/order", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const { action, orderId } = request.body || {};
  if (!orderId || !["costs", "refund", "settle"].includes(action)) return response.status(400).json({ message: "A valid finance action and order ID are required." });
  if (action === "refund") return response.status(400).json({ message: "Refunds require selected order items and quantities. Use the selected-item refund workflow." });
  try {
    const db = getDb();
    const orderRef = db.collection("orders").doc(String(orderId));
    if (action === "settle") {
      const settlementRef = db.collection("vendorSettlements").doc(String(request.body.settlementId || ""));
      await db.runTransaction(async (transaction) => {
        const [orderSnapshot, settlementSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(settlementRef)]);
        if (!orderSnapshot.exists || !settlementSnapshot.exists) throw new Error("FINANCE_RECORD_NOT_FOUND");
        const order = orderSnapshot.data();
        const settlement = settlementSnapshot.data();
        if (settlement.orderId !== orderRef.id) throw new Error("Settlement does not belong to this order.");
        const current = settlementStatusFor({ ...settlement, currentStatus: settlement.settlementStatus });
        if (current !== "payable") throw new Error("This vendor payout is not payable yet.");
        transaction.update(settlementRef, { settlementStatus: "paid", paidAmount: settlement.vendorPayout, paidAt: new Date().toISOString(), paidBy: user.uid, updatedAt: new Date().toISOString() });
        const items = (order.items || []).map((item) => item.settlementId === settlementRef.id ? { ...item, settlementStatus: "paid" } : item);
        transaction.update(orderRef, { items, sellerSuborders: groupSellerSuborders(items).map((row, index) => ({ ...row, id: `${orderRef.id}_seller_${index}`, orderId: orderRef.id })), updatedAt: new Date().toISOString() });
        stageAdminAudit(transaction, db, user, { action: "vendor_settlement_paid", entityType: "vendorSettlement", entityId: settlementRef.id, oldValue: { settlementStatus: settlement.settlementStatus, vendorPayout: settlement.vendorPayout }, newValue: { settlementStatus: "paid", paidAmount: settlement.vendorPayout } });
      });
      return response.json({ ok: true });
    }

    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) return response.status(404).json({ message: "Order not found." });
    const order = orderSnapshot.data();
    const timestamp = new Date().toISOString();
    if (action === "costs") {
      const sellerSuborders = order.sellerSuborders || [];
      const submittedSellerCosts = Array.isArray(request.body.sellerShippingCosts) ? request.body.sellerShippingCosts : [];
      if (sellerSuborders.length > 1 && submittedSellerCosts.length !== sellerSuborders.length) return response.status(400).json({ message: "Enter actual forward and return shipping cost for each seller shipment." });
      const paymentGatewayFee = Number(request.body.paymentGatewayFee);
      const paymentGatewayTax = Number(request.body.paymentGatewayTax);
      const tcsAmount = Number(request.body.tcsAmount || 0);
      const tdsAmount = Number(request.body.tdsAmount || 0);
      const sellerCostMap = new Map();
      for (const entry of submittedSellerCosts) {
        const key = `${entry.sellerType}:${entry.sellerId}`;
        const forward = Number(entry.actualForwardShippingCost);
        const isRto = sellerSuborders.find((suborder) => `${suborder.sellerType}:${suborder.sellerId}` === key)?.shipmentStatus === "rto" || sellerSuborders.find((suborder) => `${suborder.sellerType}:${suborder.sellerId}` === key)?.orderStatus === "rto";
        const rawReturn = entry.actualReturnShippingCost;
        const returnCost = rawReturn == null || rawReturn === "" ? (isRto ? null : 0) : Number(rawReturn);
        if (!Number.isFinite(forward) || forward < 0 || (returnCost != null && (!Number.isFinite(returnCost) || returnCost < 0))) return response.status(400).json({ message: "Enter non-negative actual shipping costs for each seller shipment." });
        if (isRto && returnCost == null) return response.status(400).json({ message: "An RTO return shipping cost is still required for each returned seller shipment." });
        sellerCostMap.set(key, { forward, returnCost, total: returnCost == null ? null : Number((forward + returnCost).toFixed(2)) });
      }
      if (sellerSuborders.length <= 1 && !sellerCostMap.size) {
        const forward = Number(request.body.actualForwardShippingCost ?? request.body.actualShippingCost);
        const rawReturn = request.body.actualReturnShippingCost;
        const isRto = String(order.status || order.orderStatus) === "rto";
        const returnCost = rawReturn == null || rawReturn === "" ? (isRto ? null : 0) : Number(rawReturn);
        if (!Number.isFinite(forward) || forward < 0 || (returnCost != null && (!Number.isFinite(returnCost) || returnCost < 0))) return response.status(400).json({ message: "Enter non-negative actual forward and return shipping values." });
        if (isRto && returnCost == null) return response.status(400).json({ message: "An RTO return shipping cost is required before reconciliation." });
        const onlySuborder = sellerSuborders[0];
        if (onlySuborder) sellerCostMap.set(`${onlySuborder.sellerType}:${onlySuborder.sellerId}`, { forward, returnCost, total: returnCost == null ? null : Number((forward + returnCost).toFixed(2)) });
        else sellerCostMap.set("partswala:partswala", { forward, returnCost, total: returnCost == null ? null : Number((forward + returnCost).toFixed(2)) });
      }
      if ([paymentGatewayFee, paymentGatewayTax, tcsAmount, tdsAmount].some((amount) => !Number.isFinite(amount) || amount < 0)) return response.status(400).json({ message: "Enter non-negative gateway, TCS, and TDS values." });
      const actualForwardShippingCost = [...sellerCostMap.values()].reduce((sum, row) => sum + row.forward, 0);
      const allShippingCostsKnown = [...sellerCostMap.values()].every((row) => row.total != null);
      const actualReturnShippingCost = allShippingCostsKnown ? [...sellerCostMap.values()].reduce((sum, row) => sum + Number(row.returnCost || 0), 0) : null;
      const actualShippingCost = allShippingCostsKnown ? Number([...sellerCostMap.values()].reduce((sum, row) => sum + Number(row.total || 0), 0).toFixed(2)) : null;
      const shippingDifference = actualShippingCost == null ? null : Number((Number(order.shippingChargedToCustomer || 0) - actualShippingCost).toFixed(2));
      const currentItems = order.items || [];
      const allocatedForwardShipping = currentItems.map(() => 0);
      const allocatedReturnShipping = currentItems.map(() => 0);
      for (const [sellerKey, costs] of sellerCostMap) {
        const sellerLines = currentItems.map((item, index) => ({ item, index })).filter(({ item }) => `${item.sellerType || "partswala"}:${item.sellerId || "partswala"}` === sellerKey);
        const forwardShares = allocateMoney(costs.forward, sellerLines.map(({ item }) => item));
        const returnShares = costs.returnCost == null ? sellerLines.map(() => null) : allocateMoney(costs.returnCost, sellerLines.map(({ item }) => item));
        sellerLines.forEach(({ index }, sellerIndex) => {
          allocatedForwardShipping[index] = forwardShares[sellerIndex];
          allocatedReturnShipping[index] = returnShares[sellerIndex];
        });
      }
      const allocatedGatewayFee = allocateMoney(paymentGatewayFee, currentItems);
      const allocatedGatewayTax = allocateMoney(paymentGatewayTax, currentItems);
      const allocatedTcs = allocateMoney(tcsAmount, currentItems);
      const allocatedTds = allocateMoney(tdsAmount, currentItems);
      const vendorGatewayFeeShareRate = Math.max(0, Math.min(100, Number(order.finance?.vendorGatewayFeeShareRate || 0)));
      const items = currentItems.map((item, index) => ({
        ...item,
        actualForwardShippingCost: allocatedForwardShipping[index],
        actualReturnShippingCost: allocatedReturnShipping[index],
        actualShippingCost: allocatedReturnShipping[index] == null ? null : Number((allocatedForwardShipping[index] + allocatedReturnShipping[index]).toFixed(2)),
        shippingDifference: allocatedReturnShipping[index] == null ? null : Number((Number(item.shippingChargedToCustomer || 0) - allocatedForwardShipping[index] - allocatedReturnShipping[index]).toFixed(2)),
        paymentGatewayFee: allocatedGatewayFee[index],
        paymentGatewayTax: allocatedGatewayTax[index],
        vendorGatewayFeeDeduction: item.sellerType === "vendor" ? Math.min(Number(item.originalVendorPayout ?? item.vendorPayout ?? 0), Number((allocatedGatewayFee[index] * vendorGatewayFeeShareRate / 100).toFixed(2))) : 0,
        vendorPayout: item.sellerType === "vendor" ? Math.max(0, Number((Number(item.originalVendorPayout ?? item.vendorPayout ?? 0) - allocatedGatewayFee[index] * vendorGatewayFeeShareRate / 100).toFixed(2))) : 0,
        tcsAmount: allocatedTcs[index],
        tdsAmount: allocatedTds[index],
        netPaymentReceived: Number((Number(item.customerLineTotal || 0) - Number(item.refundAmount || 0) - allocatedGatewayFee[index] - allocatedGatewayTax[index]).toFixed(2)),
      }));
      const finance = buildFinanceTotals(items, {
        shippingChargedToCustomer: order.shippingChargedToCustomer || 0,
        shippingRefundAmount: order.shippingRefundAmount || 0,
        codFeeAmount: order.codFee || 0,
        codFeeRefundAmount: order.codFeeRefundAmount || 0,
        actualShippingCost,
        paymentGatewayFee,
        paymentGatewayTax,
        refundAmount: order.refundedAmount || 0,
        tcsAmount,
        tdsAmount,
        shippingDifferencePolicy: order.finance?.shippingDifferencePolicy || "absorb",
      });
      await db.runTransaction(async (transaction) => {
        const currentOrderSnapshot = await transaction.get(orderRef);
        if (!currentOrderSnapshot.exists) throw new Error("FINANCE_RECORD_NOT_FOUND");
        if (currentOrderSnapshot.data()?.updatedAt !== order.updatedAt) throw new Error("FINANCE_CONCURRENT_UPDATE");
        const settlementRefs = items.filter((item) => item.settlementId).map((item) => db.collection("vendorSettlements").doc(item.settlementId));
        const settlementSnapshots = await Promise.all(settlementRefs.map((reference) => transaction.get(reference)));
        if (settlementSnapshots.some((snapshot) => snapshot.exists && snapshot.data()?.settlementStatus === "paid")) throw new Error("PAID_SETTLEMENT_REQUIRES_ADJUSTMENT");
        items.forEach((item) => {
          if (!item.settlementId) return;
          transaction.update(db.collection("vendorSettlements").doc(item.settlementId), {
            shippingAmount: item.shippingChargedToCustomer,
            actualShippingCost: item.actualShippingCost,
            shippingDifference: item.shippingDifference,
            paymentGatewayFee: item.paymentGatewayFee,
            vendorGatewayFeeDeduction: item.vendorGatewayFeeDeduction,
            otherDeductions: Number((Number(item.platformServiceFee || 0) + Number(item.vendorGatewayFeeDeduction || 0)).toFixed(2)),
            vendorPayout: item.vendorPayout,
            paymentGatewayTax: item.paymentGatewayTax,
            tcsAmount: item.tcsAmount,
            tdsAmount: item.tdsAmount,
            netPaymentReceived: item.netPaymentReceived,
            updatedAt: timestamp,
          });
        });
        const groupedSuborders = groupSellerSuborders(items).map((row, index) => {
          const costs = sellerCostMap.get(`${row.sellerType}:${row.sellerId}`);
          return { ...row, id: `${orderRef.id}_seller_${index}`, orderId: orderRef.id, actualForwardShippingCost: costs?.forward ?? null, actualReturnShippingCost: costs?.returnCost ?? null, shippingReconciliationStatus: costs?.total == null ? "pending_actual_courier_costs" : "reconciled" };
        });
        transaction.update(orderRef, { items, sellerSuborders: groupedSuborders, actualShippingCost, actualForwardShippingCost, actualReturnShippingCost, shippingDifference, shippingReconciliationStatus: allShippingCostsKnown ? "reconciled" : "pending_actual_return_cost", paymentGatewayFee, paymentGatewayTax, tcsAmount, tdsAmount, netPaymentReceived: finance.netPaymentReceived, platformRevenue: finance.platformRevenue, finance, updatedAt: timestamp });
        stageAdminAudit(transaction, db, user, { action: "finance_costs_updated", entityType: "order", entityId: orderRef.id, oldValue: { actualForwardShippingCost: order.actualForwardShippingCost ?? null, actualReturnShippingCost: order.actualReturnShippingCost ?? null, paymentGatewayFee: order.paymentGatewayFee ?? null }, newValue: { actualForwardShippingCost, actualReturnShippingCost, actualShippingCost, shippingDifference, paymentGatewayFee, paymentGatewayTax, tcsAmount, tdsAmount }, reason: String(request.body.reason || ""), timestamp });
      });
      return response.json({ ok: true, finance });
    }

    const originalItems = order.items || [];
    const refundRequestId = String(request.body.refundRequestId || "").trim();
    if (refundRequestId.length < 8 || refundRequestId.length > 128) return response.status(400).json({ message: "A valid refund request ID is required." });
    const adjustmentReason = String(request.body.reason || "").trim().slice(0, 1000);
    const refundRequestRef = db.collection("refundRequests").doc(createHash("sha256").update(`${user.uid}:${orderRef.id}:${refundRequestId}`).digest("hex"));
    const selectedRefund = Array.isArray(request.body.items)
      ? planSelectedRefund(originalItems, request.body.items)
      : null;
    const addedRefund = selectedRefund ? selectedRefund.amount : Number(request.body.refundAmount);
    if (!Number.isFinite(addedRefund) || addedRefund <= 0) return response.status(400).json({ message: "Refund amount must be greater than zero." });
    const nextRefund = Number((Number(order.refundedAmount || 0) + addedRefund).toFixed(2));
    const orderTotal = Number(order.grandTotal || order.totalAmount || 0);
    if (nextRefund > orderTotal) return response.status(400).json({ message: "Refund total cannot exceed customer payment." });
    const fullRefund = nextRefund >= orderTotal;
    const refundAllocations = selectedRefund?.allocations || allocateMoney(addedRefund, originalItems);
    const items = originalItems.map((item, index) => {
      const lineRefund = refundAllocations[index];
      if (selectedRefund && lineRefund === 0) return item;
      const cumulativeLineRefund = Number((Number(item.refundAmount || 0) + lineRefund).toFixed(2));
      const reversal = calculateRefundReversal(item, cumulativeLineRefund, fullRefund);
      const lineRefundRatio = item.customerLineTotal > 0 ? cumulativeLineRefund / item.customerLineTotal : 0;
      return {
        ...item,
        ...(selectedRefund && selectedRefund.allocations[index] > 0 ? { refundedQuantity: Number(item.refundedQuantity || 0) + Number(request.body.items.find((entry) => String(entry.productId) === String(item.productId)).quantity) } : {}),
        refundAmount: reversal.refundAmount,
        sellerSubtotal: fullRefund ? 0 : Number((Number(item.originalSellerSubtotal ?? item.sellerSubtotal ?? 0) * (1 - lineRefundRatio)).toFixed(2)),
        platformServiceRevenue: fullRefund ? 0 : Number((Number(item.originalPlatformServiceRevenue ?? item.platformServiceRevenue ?? 0) * (1 - lineRefundRatio)).toFixed(2)),
        shippingRefundAmount: fullRefund ? Number(item.shippingChargedToCustomer || 0) : Number((Number(item.shippingChargedToCustomer || 0) * lineRefundRatio).toFixed(2)),
        codFeeRefundAmount: fullRefund ? Number(item.codFee || 0) : Number((Number(item.codFee || 0) * lineRefundRatio).toFixed(2)),
        taxRefundAmount: fullRefund ? Number(item.taxAmount || 0) : Number((Number(item.taxAmount || 0) * lineRefundRatio).toFixed(2)),
        commissionAmount: reversal.commissionAmount,
        commissionAdjustment: reversal.commissionAdjustment,
        vendorPayout: reversal.vendorPayout,
        vendorPayoutAdjustment: reversal.vendorPayoutAdjustment,
        platformRevenue: reversal.platformRevenue,
        platformRevenueAdjustment: reversal.platformRevenueAdjustment,
        settlementStatus: reversal.settlementStatus,
      };
    });
    const finance = buildFinanceTotals(items, {
      shippingChargedToCustomer: order.shippingChargedToCustomer || 0,
      shippingRefundAmount: items.reduce((sum, item) => sum + Number(item.shippingRefundAmount || 0), 0),
      codFeeAmount: order.codFee || 0,
      codFeeRefundAmount: items.reduce((sum, item) => sum + Number(item.codFeeRefundAmount || 0), 0),
      actualShippingCost: order.actualShippingCost,
      paymentGatewayFee: order.paymentGatewayFee,
      paymentGatewayTax: order.paymentGatewayTax,
      refundAmount: nextRefund,
      shippingDifferencePolicy: order.finance?.shippingDifferencePolicy || "absorb",
    });
    const refundResult = await db.runTransaction(async (transaction) => {
      const [refundRequestSnapshot, currentOrderSnapshot] = await Promise.all([
        transaction.get(refundRequestRef),
        transaction.get(orderRef),
      ]);
      if (refundRequestSnapshot.exists) return { duplicate: true, ...refundRequestSnapshot.data() };
      if (!currentOrderSnapshot.exists) throw new Error("FINANCE_RECORD_NOT_FOUND");
      const currentOrder = currentOrderSnapshot.data();
      if (Number(currentOrder.refundedAmount || 0) !== Number(order.refundedAmount || 0)) throw new Error("REFUND_CONCURRENT_UPDATE");
      const settlementRefs = items.filter((item) => item.settlementId).map((item) => db.collection("vendorSettlements").doc(item.settlementId));
      const settlementSnapshots = await Promise.all(settlementRefs.map((reference) => transaction.get(reference)));
      const settlementById = new Map(settlementSnapshots.map((snapshot) => [snapshot.id, snapshot]));
      const paidSettlementItems = items.filter((item) => item.settlementId && settlementById.get(item.settlementId)?.data()?.settlementStatus === "paid");
      if (paidSettlementItems.length && !adjustmentReason) throw new Error("ADJUSTMENT_REASON_REQUIRED");
      for (const item of items) {
        if (!item.settlementId) continue;
        const settlementRef = db.collection("vendorSettlements").doc(item.settlementId);
        const settlementSnapshot = settlementById.get(item.settlementId);
        if (settlementSnapshot?.data()?.settlementStatus === "paid") {
          const original = settlementSnapshot.data();
          const adjustmentRef = db.collection("financeAdjustments").doc();
          const oldAmount = Number(original.vendorPayout || 0);
          const newNetAmount = Number(item.vendorPayout || 0);
          transaction.create(adjustmentRef, {
            adjustmentId: adjustmentRef.id,
            originalTransaction: item.settlementId,
            orderId: orderRef.id,
            vendorId: item.sellerId,
            action: "refund_payout_reversal",
            oldAmount,
            adjustmentAmount: Number((newNetAmount - oldAmount).toFixed(2)),
            newNetAmount,
            oldCommissionAmount: Number(original.commissionAmount || 0),
            newCommissionAmount: Number(item.commissionAmount || 0),
            reason: adjustmentReason,
            adminId: user.uid,
            timestamp,
          });
          continue;
        }
        transaction.update(settlementRef, {
          sellerSubtotal: item.sellerSubtotal,
          refundAmount: item.refundAmount,
          commissionAmount: item.commissionAmount,
          platformServiceFee: item.platformServiceFee,
          vendorPayout: item.vendorPayout,
          otherDeductions: Number((Number(item.platformServiceFee || 0) + Number(item.vendorGatewayFeeDeduction || 0)).toFixed(2)),
          recoveryDue: Number((Math.max(0, Number(order.items.find((orderItem) => orderItem.settlementId === item.settlementId)?.paidAmount || 0) - Number(item.vendorPayout || 0))).toFixed(2)),
          settlementStatus: item.settlementStatus,
          updatedAt: timestamp,
        });
      }
      transaction.update(orderRef, {
        items,
        sellerSuborders: groupSellerSuborders(items).map((suborder, index) => ({ ...suborder, id: `${orderRef.id}_seller_${index}`, orderId: orderRef.id })),
        refundedAmount: nextRefund,
        refundAmount: nextRefund,
        refundStatus: fullRefund ? "refunded" : "partial",
        refundActivity: {
          date: timestamp.slice(0, 10),
          amount: Number(((order.refundActivity?.date === timestamp.slice(0, 10) ? Number(order.refundActivity.amount || 0) : 0) + addedRefund).toFixed(2)),
        },
        shippingRefundAmount: items.reduce((sum, item) => sum + Number(item.shippingRefundAmount || 0), 0),
        refundShipping: items.reduce((sum, item) => sum + Number(item.shippingRefundAmount || 0), 0),
        refundTax: items.reduce((sum, item) => sum + Number(item.taxRefundAmount || 0), 0),
        commissionAdjustment: items.reduce((sum, item) => sum + Number(item.commissionAdjustment || 0), 0),
        vendorPayoutAdjustment: items.reduce((sum, item) => sum + Number(item.vendorPayoutAdjustment || 0), 0),
        codFeeRefundAmount: items.reduce((sum, item) => sum + Number(item.codFeeRefundAmount || 0), 0),
        finance,
        vendorPayables: finance.vendorPayables,
        platformCommission: finance.platformCommission,
        platformRevenue: finance.platformRevenue,
        netPaymentReceived: finance.netPaymentReceived,
        updatedAt: timestamp,
      });
      transaction.create(refundRequestRef, { orderId: orderRef.id, amount: addedRefund, refundedAmount: nextRefund, status: fullRefund ? "refunded" : "partial", createdBy: user.uid, createdAt: timestamp });
      stageAdminAudit(transaction, db, user, { action: "refund_recorded", entityType: "order", entityId: orderRef.id, oldValue: { refundedAmount: Number(order.refundedAmount || 0) }, newValue: { refundedAmount: nextRefund, refundRequestId }, reason: adjustmentReason, timestamp });
      return { duplicate: false, refundAmount: nextRefund, fullRefund, finance };
    });
    return response.json({ ok: true, ...refundResult });
  } catch (error) {
    const status = error.message === "FINANCE_RECORD_NOT_FOUND" ? 404 : error.message === "REFUND_CONCURRENT_UPDATE" ? 409 : error.message === "ADJUSTMENT_REASON_REQUIRED" ? 400 : 400;
    return response.status(status).json({ message: error.message || "Finance update failed." });
  }
});

app.post("/api/admin/refunds", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const orderId = String(request.body?.orderId || "").trim();
  const requestId = String(request.body?.requestId || "").trim();
  const reason = String(request.body?.reason || "").trim().slice(0, 1000);
  const selections = Array.isArray(request.body?.items) ? request.body.items : [];
  if (!orderId || requestId.length < 8 || requestId.length > 128 || !reason || !selections.length || selections.length > 20) {
    return response.status(400).json({ message: "Provide order, reason, request ID, and selected refund quantities." });
  }
  try {
    const db = getDb();
    const orderRef = db.collection("orders").doc(orderId);
    const refundId = createHash("sha256").update(`${orderId}:${requestId}`).digest("hex");
    const refundRef = db.collection("refundRequests").doc(refundId);
    const timestamp = new Date().toISOString();
    const result = await db.runTransaction(async (transaction) => {
      const [refundSnapshot, orderSnapshot] = await Promise.all([
        transaction.get(refundRef),
        transaction.get(orderRef),
      ]);
      if (refundSnapshot.exists) return { duplicate: true, ...refundSnapshot.data() };
      if (!orderSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
      const order = orderSnapshot.data();
      if (!["Paid", "COD collected"].includes(order.paymentStatus)) throw new Error("PAYMENT_NOT_COLLECTED");
      if (!["razorpay", "phonepe"].includes(String(order.paymentGateway || "")) && order.paymentMethod !== "COD") throw new Error("REFUND_PROVIDER_UNSUPPORTED");
      const pendingAmount = Number(order.refundPendingAmount || 0);
      const paidAmount = order.paymentStatus === "COD collected" ? Number(order.codCollectedAmount ?? order.grandTotal ?? 0) : Number(order.grandTotal || 0);
      const refundableRemaining = Number((paidAmount - Number(order.refundedAmount || 0) - pendingAmount).toFixed(2));
      const pendingByProduct = new Map(Object.entries(order.refundPendingQuantities || {}).map(([productId, quantity]) => [productId, Number(quantity || 0)]));
      const sourceItems = (order.items || []).map((item) => ({ ...item, refundedQuantity: Number(item.refundedQuantity || 0) + Number(pendingByProduct.get(item.productId) || 0) }));
      const plan = planSelectedRefund(sourceItems, selections);
      if (plan.amount <= 0 || plan.amount > refundableRemaining) throw new Error("REFUND_EXCEEDS_REMAINING_AMOUNT");
      const selectedItems = selections.map((selection) => {
        const orderItem = sourceItems.find((item) => String(item.productId) === String(selection.productId));
        return {
          productId: orderItem.productId,
          name: orderItem.name || orderItem.productName || "Product",
          quantity: Number(selection.quantity),
          sellerId: orderItem.sellerId || "partswala",
          sellerType: orderItem.sellerType || "partswala",
          settlementId: orderItem.settlementId || null,
          lineRefundAmount: plan.allocations[sourceItems.indexOf(orderItem)],
          unitPrice: orderItem.unitPrice ?? orderItem.price,
          discount: orderItem.discount,
          taxableValue: orderItem.taxableValue ?? orderItem.sellerSubtotal,
          gstRate: orderItem.gstRate,
          cgst: orderItem.cgst,
          sgst: orderItem.sgst,
          igst: orderItem.igst,
          taxAmount: Number(((Number(orderItem.originalTaxAmount ?? orderItem.taxAmount ?? orderItem.gstTotal ?? 0) * Number(selection.quantity)) / Number(orderItem.orderedQuantity ?? orderItem.quantity)).toFixed(2)),
          commissionAmount: Number(((Number(orderItem.originalCommissionAmount ?? orderItem.commissionAmount ?? 0) * Number(selection.quantity)) / Number(orderItem.orderedQuantity ?? orderItem.quantity)).toFixed(2)),
          vendorPayout: Number(((Number(orderItem.originalVendorPayout ?? orderItem.vendorPayout ?? 0) * Number(selection.quantity)) / Number(orderItem.orderedQuantity ?? orderItem.quantity)).toFixed(2)),
        };
      });
      const status = order.paymentMethod === "COD" ? "refund_requested" : "refund_requested";
      transaction.create(refundRef, {
        refundRequestId: refundId,
        orderId,
        userId: order.userId,
        requestedBy: user.uid,
        provider: order.paymentGateway || "manual_cod",
        paymentId: order.paymentId || null,
        invoiceNumber: order.invoiceNumber,
        amount: plan.amount,
        items: selectedItems,
        reason,
        status,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      stageAdminAudit(transaction, db, user, { action: "refund_requested", entityType: "refundRequest", entityId: refundId, oldValue: { refundedAmount: Number(order.refundedAmount || 0), refundPendingAmount: pendingAmount }, newValue: { amount: plan.amount, items: selectedItems.map(({ productId, quantity, lineRefundAmount }) => ({ productId, quantity, lineRefundAmount })), status: "refund_requested" }, reason, timestamp });
      const pendingQuantities = { ...(order.refundPendingQuantities || {}) };
      selectedItems.forEach((item) => { pendingQuantities[item.productId] = Number(pendingQuantities[item.productId] || 0) + item.quantity; });
      transaction.update(orderRef, { refundPendingAmount: Number((pendingAmount + plan.amount).toFixed(2)), refundPendingQuantities: pendingQuantities, updatedAt: timestamp });
      const selectedBySeller = new Map();
      selectedItems.forEach((item) => {
        const sellerKey = `${item.sellerType}:${item.sellerId}`;
        const group = selectedBySeller.get(sellerKey) || [];
        group.push(item);
        selectedBySeller.set(sellerKey, group);
      });
      for (const [sellerKey, sellerItems] of selectedBySeller) {
        const firstItem = sellerItems[0];
        const creditNoteId = `${refundId}_${createHash("sha256").update(sellerKey).digest("hex").slice(0, 12)}`;
        transaction.create(db.collection("creditNotes").doc(creditNoteId), {
          creditNoteId,
          originalInvoiceId: order.items.find((orderItem) => orderItem.productId === firstItem.productId)?.sellerInvoiceNumber || order.invoiceNumber,
          orderId,
          sellerId: firstItem.sellerId,
          sellerType: firstItem.sellerType,
          reason,
          items: sellerItems.map((item) => ({ productId: item.productId, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, discount: item.discount, taxableAmount: item.taxableValue, gst: item.taxAmount, refundAmount: item.lineRefundAmount })),
          taxableAmount: Number(sellerItems.reduce((sum, item) => sum + Number(item.taxableValue || 0), 0).toFixed(2)),
          gst: Number(sellerItems.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0).toFixed(2)),
          refundAmount: Number(sellerItems.reduce((sum, item) => sum + Number(item.lineRefundAmount || 0), 0).toFixed(2)),
          createdAt: timestamp,
          status: "refund_requested",
          accountingReview: "CA_REVIEW_REQUIRED",
          refundRequestId: refundId,
        });
      }
      return { duplicate: false, refundRequestId: refundId, amount: plan.amount, status, provider: order.paymentGateway || "manual_cod" };
    });
    if (!result.duplicate && result.status === "refund_requested" && result.provider !== "manual_cod") await submitProviderRefund(db, refundRef);
    const current = (await refundRef.get()).data();
    return response.status(result.duplicate ? 200 : 202).json({ ...result, status: current?.status || result.status, providerRefundId: current?.providerRefundId || null });
  } catch (error) {
    const status = error.message === "ORDER_NOT_FOUND" ? 404 : error.message === "PAYMENT_NOT_COLLECTED" || error.message === "REFUND_PROVIDER_UNSUPPORTED" || error.message === "REFUND_EXCEEDS_REMAINING_AMOUNT" ? 409 : 400;
    return response.status(status).json({ message: error.message || "Refund could not be requested." });
  }
});

app.patch("/api/admin/refunds/:refundId/manual-complete", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const reference = String(request.body?.reference || "").trim().slice(0, 160);
  if (reference.length < 3) return response.status(400).json({ message: "Provide the actual bank/courier refund reference." });
  try {
    const db = getDb();
    const refundRef = db.collection("refundRequests").doc(String(request.params.refundId));
    const refundSnapshot = await refundRef.get();
    if (!refundSnapshot.exists) return response.status(404).json({ message: "Refund request was not found." });
    const refund = refundSnapshot.data();
    if (refund.provider !== "manual_cod") return response.status(409).json({ message: "Provider refunds must be completed by the signed provider webhook." });
    const eventId = createHash("sha256").update(`manual-cod-refund:${refundRef.id}:${reference}`).digest("hex");
    const result = await finalizeProviderRefund(db, refundRef, db.collection("webhookEvents").doc(eventId), "processed", reference);
    if (!result.duplicate) {
      const timestamp = new Date().toISOString();
      await refundRef.update({ manualRefundReference: reference, manuallyCompletedBy: user.uid, completedAt: timestamp, updatedAt: timestamp });
    }
    return response.json({ ok: true, ...result });
  } catch (error) {
    const status = error.message === "REFUND_EXCEEDS_COLLECTED_AMOUNT" || error.message === "REFUND_EXCEEDS_REMAINING_QUANTITY" ? 409 : 400;
    return response.status(status).json({ message: error.message || "Manual COD refund could not be reconciled." });
  }
});

app.post("/api/admin/orders/status", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const { orderId, status } = request.body || {};
  const normalizedStatus = normalizeLifecycleStatus(status);
  const overrideProblem = adminLifecycleOverrideProblem(normalizedStatus);
  if (overrideProblem) return response.status(overrideProblem.status).json({ code: overrideProblem.code, message: overrideProblem.message });
  if (!orderId || !canTransitionLifecycle("pending", normalizedStatus)) return response.status(400).json({ message: "Choose a valid order status." });
  try {
    const db = getDb();
    const orderRef = db.collection("orders").doc(String(orderId));
    const timestamp = new Date().toISOString();
    await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
      const order = orderSnapshot.data();
      if (!canTransitionLifecycle(order.status || order.orderStatus, normalizedStatus)) throw new Error("INVALID_ORDER_TRANSITION");
      if (normalizedStatus === "cancelled" && ["Paid", "COD collected"].includes(order.paymentStatus)) throw new Error("A paid order must be refunded before it can be cancelled.");
      const settingsSnapshot = await transaction.get(db.doc("settings/store"));
      const settlementRefs = (order.items || []).filter((item) => item.settlementId).map((item) => db.collection("vendorSettlements").doc(item.settlementId));
      const settlementSnapshots = await Promise.all(settlementRefs.map((reference) => transaction.get(reference)));
      const paidSettlementIds = new Set(settlementSnapshots.filter((snapshot) => snapshot.exists && snapshot.data()?.settlementStatus === "paid").map((snapshot) => snapshot.id));
      const inventoryReleased = normalizedStatus === "cancelled"
        ? await releaseInventoryReservation(transaction, db, order, timestamp)
        : false;
      const holdDays = Math.max(0, Number(settingsSnapshot.data()?.settlementHoldDays ?? 7));
      const eligibleAt = normalizedStatus === "delivered"
        ? new Date(Date.now() + holdDays * 86400000).toISOString()
        : normalizedStatus === "completed"
          ? order.vendorSettlementEligibleAt || new Date().toISOString()
          : order.vendorSettlementEligibleAt || null;
      const paymentStatus = order.paymentStatus;
      const event = { status: normalizedStatus, label: normalizedStatus.replace(/_/g, " "), timestamp };
      const nextItems = (order.items || []).map((item) => ({
        ...item,
        sellerSubtotal: normalizedStatus === "cancelled" && item.sellerType === "vendor" ? 0 : item.sellerSubtotal,
        commissionAmount: normalizedStatus === "cancelled" && item.sellerType === "vendor" ? 0 : item.commissionAmount,
        vendorPayout: normalizedStatus === "cancelled" && item.sellerType === "vendor" ? 0 : item.vendorPayout,
        platformRevenue: normalizedStatus === "cancelled" && item.sellerType === "vendor" ? 0 : item.platformRevenue,
        settlementStatus: normalizedStatus === "return_requested" || normalizedStatus === "cancelled"
          ? "held"
          : normalizedStatus === "completed" && item.settlementStatus === "held"
            ? "pending"
            : item.settlementStatus,
      }));
      const sellerSuborders = groupSellerSuborders(nextItems).map((suborder, index) => {
        const sellerItems = nextItems.filter((item) => item.sellerId === suborder.sellerId && item.sellerType === suborder.sellerType);
        const statuses = sellerItems.map((item) => item.settlementStatus);
        return {
          ...suborder,
          id: `${orderRef.id}_seller_${index}`,
          orderId: orderRef.id,
          orderStatus: normalizedStatus,
          settlementStatus: statuses.every((value) => value === "paid") ? "paid" : statuses.includes("held") ? "held" : suborder.settlementStatus,
        };
      });
      transaction.update(orderRef, {
        status: normalizedStatus,
        orderStatus: normalizedStatus,
        paymentStatus,
        ...(normalizedStatus === "delivered" && order.paymentMethod === "COD" ? { paymentReconciliationStatus: "pending_cod_collection" } : {}),
        items: nextItems,
        sellerSuborders,
        ...(inventoryReleased ? { inventoryReservationStatus: "released", inventoryReleasedAt: timestamp } : {}),
        vendorSettlementEligibleAt: eligibleAt,
        timeline: [...(order.timeline || []), event],
        deliveredAt: normalizedStatus === "delivered" ? timestamp : order.deliveredAt || null,
        updatedAt: timestamp,
      });
      stageAdminAudit(transaction, db, user, { action: "order_status_changed", entityType: "order", entityId: orderRef.id, oldValue: { status: order.status || order.orderStatus }, newValue: { status: normalizedStatus }, reason: String(request.body.reason || ""), timestamp });
      for (const item of order.items || []) {
        if (!item.settlementId || paidSettlementIds.has(item.settlementId)) continue;
        transaction.update(db.collection("vendorSettlements").doc(item.settlementId), {
          sellerSubtotal: item.sellerSubtotal,
          commissionAmount: item.commissionAmount,
          vendorPayout: item.vendorPayout,
          orderStatus: normalizedStatus,
          paymentStatus,
          eligibleAt,
          settlementStatus: normalizedStatus === "cancelled" || normalizedStatus === "return_requested"
            ? "held"
            : normalizedStatus === "completed" && item.settlementStatus === "held"
              ? "pending"
              : item.settlementStatus,
          updatedAt: timestamp,
        });
      }
    });
    return response.json({ ok: true, status: normalizedStatus });
  } catch (error) {
    return response.status(error.message === "ORDER_NOT_FOUND" ? 404 : 400).json({ message: error.message || "Order status could not be updated." });
  }
});

app.post("/api/admin/orders/cod-collection", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  if (!isAdminUser(user)) return response.status(403).json({ message: "Admin access required." });
  const orderId = String(request.body?.orderId || "").trim();
  const reference = String(request.body?.reference || "").trim().slice(0, 120);
  const amount = Number(request.body?.amount);
  if (!orderId || reference.length < 3) return response.status(400).json({ message: "Provide the order and courier settlement reference." });
  try {
    const db = getDb();
    const orderRef = db.collection("orders").doc(orderId);
    const timestamp = new Date().toISOString();
    const collectionId = createHash("sha256").update(`${orderId}:${reference}`).digest("hex");
    const collectionRef = db.collection("codCollections").doc(collectionId);
    const result = await db.runTransaction(async (transaction) => {
      const remittanceQuery = db.collection("codCollections").where("orderId", "==", orderId);
      const [orderSnapshot, collectionSnapshot, remittanceSnapshot] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(collectionRef),
        transaction.get(remittanceQuery),
      ]);
      if (!orderSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
      if (collectionSnapshot.exists) return {
        duplicate: true,
        amount: collectionSnapshot.data().amount,
        paymentStatus: orderSnapshot.data().paymentStatus,
        paymentCollectedAmount: orderSnapshot.data().paymentCollectedAmount || 0,
      };
      const order = orderSnapshot.data();
      const recordedPaise = remittanceSnapshot.docs.reduce((sum, document) => sum + Math.round(Number(document.data().amount || 0) * 100), 0);
      const storedCollected = Number(order.paymentCollectedAmount ?? order.codCollectedAmount ?? 0);
      const previouslyCollected = Math.max(recordedPaise, Math.round(storedCollected * 100)) / 100;
      const plan = planCodCollection({
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        orderTotal: order.grandTotal,
        amount,
        alreadyCollected: previouslyCollected,
        status: order.status || order.orderStatus,
      });
      const settlementRefs = plan.isComplete
        ? (order.items || []).filter((item) => item.settlementId).map((item) => db.collection("vendorSettlements").doc(item.settlementId))
        : [];
      const settlementSnapshots = await Promise.all(settlementRefs.map((settlementRef) => transaction.get(settlementRef)));
      const paymentStatus = plan.isComplete ? "COD collected" : order.paymentStatus || "Pending";
      transaction.create(collectionRef, {
        collectionId,
        orderId,
        amount: plan.amount,
        cumulativeAmount: plan.paymentCollectedAmount,
        isFinalRemittance: plan.isComplete,
        reference,
        reconciledBy: user.uid,
        createdAt: timestamp,
      });
      transaction.update(orderRef, {
        paymentStatus,
        paymentCollectedAmount: plan.paymentCollectedAmount,
        codCollectedAmount: plan.paymentCollectedAmount,
        ...(plan.isComplete ? { codCollectionReference: reference, codCollectedAt: timestamp } : {}),
        paymentReconciliationStatus: plan.isComplete ? "reconciled" : "partial_remittance",
        updatedAt: timestamp,
      });
      if (plan.isComplete) settlementSnapshots.forEach((snapshot) => {
        if (snapshot.exists) transaction.update(snapshot.ref, { paymentStatus: "COD collected", updatedAt: timestamp });
      });
      stageAdminAudit(transaction, db, user, { action: "cod_collection_reconciled", entityType: "order", entityId: orderId, oldValue: { paymentStatus: order.paymentStatus, paymentCollectedAmount: Number(order.paymentCollectedAmount || 0) }, newValue: { paymentStatus, paymentCollectedAmount: plan.paymentCollectedAmount, finalRemittance: plan.isComplete }, reason: reference, timestamp });
      return { duplicate: false, amount: plan.amount, paymentCollectedAmount: plan.paymentCollectedAmount, paymentStatus };
    });
    return response.json({ ok: true, ...result });
  } catch (error) {
    const status = error.message === "ORDER_NOT_FOUND" ? 404 : 409;
    return response.status(status).json({ message: error.message || "COD collection could not be reconciled." });
  }
});

app.post("/api/orders/cancel-items", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  const orderId = String(request.body?.orderId || "").trim();
  const requestId = String(request.body?.requestId || "").trim();
  const requestedItems = Array.isArray(request.body?.items) ? request.body.items : [];
  if (!orderId || requestId.length < 8 || requestId.length > 128 || requestedItems.length === 0 || requestedItems.length > 20) {
    return response.status(400).json({ message: "Provide an order, a cancellation request ID, and selected item quantities." });
  }
  try {
    const db = getDb();
    const orderRef = db.collection("orders").doc(orderId);
    const cancellationKey = createHash("sha256").update(`${user.uid}:${orderId}:${requestId}`).digest("hex");
    const cancellationRef = db.collection("cancellationRequests").doc(cancellationKey);
    const timestamp = new Date().toISOString();
    const result = await db.runTransaction(async (transaction) => {
      const [orderSnapshot, cancellationSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(cancellationRef)]);
      if (!orderSnapshot.exists || orderSnapshot.data().userId !== user.uid) throw new Error("ORDER_NOT_FOUND");
      if (cancellationSnapshot.exists) return { ...cancellationSnapshot.data(), duplicate: true };
      const order = orderSnapshot.data();
      const allowedStatuses = ["pending", "confirmed", "processing", "partially_cancelled"];
      if (!allowedStatuses.includes(String(order.status || order.orderStatus).toLowerCase()) || order.shippingStatus !== "pending" || order.tracking?.awb || order.tracking?.shipmentId) throw new Error("CANCELLATION_SHIPMENT_STARTED");
      if (order.paymentMethod !== "COD" && order.paymentStatus !== "Paid") throw new Error("PAYMENT_NOT_CONFIRMED");

      const selections = new Map();
      for (const entry of requestedItems) {
        const productId = String(entry?.productId || "").trim();
        const quantity = Number(entry?.quantity);
        if (!productId || !Number.isInteger(quantity) || quantity <= 0 || selections.has(productId)) throw new Error("INVALID_CANCELLATION_ITEM");
        selections.set(productId, quantity);
      }
      const orderItems = order.items || [];
      const selectedLines = orderItems.filter((item) => selections.has(String(item.productId)));
      if (selectedLines.length !== selections.size) throw new Error("INVALID_CANCELLATION_ITEM");
      for (const item of selectedLines) {
        if (item.returnStatus && !["rejected", "closed"].includes(String(item.returnStatus).toLowerCase())) throw new Error("CANCELLATION_ITEM_RETURNED");
        if (Number(item.refundedQuantity || 0) > 0 || Number(item.refundAmount || 0) >= Number(item.customerLineTotal || 0)) throw new Error("CANCELLATION_ITEM_REFUNDED");
        if (["cancelled", "partially_cancelled"].includes(String(item.itemStatus || "").toLowerCase()) && Number(item.remainingQuantity ?? item.quantity) <= 0) throw new Error("CANCELLATION_ITEM_ALREADY_CANCELLED");
        const alreadyCancelled = Number(item.cancelledQuantity || 0);
        if (alreadyCancelled + selections.get(String(item.productId)) > Number(item.orderedQuantity ?? item.quantity)) throw new Error("INVALID_CANCELLATION_ITEM");
      }

      const newCancelled = new Map(selectedLines.map((item) => [String(item.productId), selections.get(String(item.productId))]));
      const sellerHasRemaining = new Map();
      for (const item of orderItems) {
        const orderedQuantity = Number(item.orderedQuantity ?? item.quantity);
        const activeQuantity = orderedQuantity - Number(item.cancelledQuantity || 0) - Number(newCancelled.get(String(item.productId)) || 0);
        const sellerKey = `${item.sellerType || "partswala"}:${item.sellerId || "partswala"}`;
        sellerHasRemaining.set(sellerKey, (sellerHasRemaining.get(sellerKey) || 0) + Math.max(0, activeQuantity));
      }
      const shippingRefundByProduct = new Map();
      for (const item of selectedLines) {
        const sellerKey = `${item.sellerType || "partswala"}:${item.sellerId || "partswala"}`;
        if (sellerHasRemaining.get(sellerKey) === 0) shippingRefundByProduct.set(String(item.productId), Number(item.shippingChargedToCustomer || item.shippingAmount || 0));
      }
      const cancellationPlans = selectedLines.map((item) => planItemCancellation(
        item,
        selections.get(String(item.productId)),
        Number(item.cancelledQuantity || 0),
        shippingRefundByProduct.get(String(item.productId)) || 0,
      ));
      const planByProduct = new Map(cancellationPlans.map((plan) => [plan.productId, plan]));
      const canceledTotal = Number(cancellationPlans.reduce((sum, plan) => sum + plan.refundAmount, 0).toFixed(2));
      const productRefs = selectedLines.map((item) => db.collection("products").doc(String(item.productId)));
      const productSnapshots = await Promise.all(productRefs.map((reference) => transaction.get(reference)));
      if (productSnapshots.some((snapshot) => !snapshot.exists)) throw new Error("CANCELLATION_PRODUCT_NOT_FOUND");
      const settlementRefs = selectedLines.filter((item) => item.settlementId).map((item) => db.collection("vendorSettlements").doc(item.settlementId));
      const settlementSnapshots = await Promise.all(settlementRefs.map((reference) => transaction.get(reference)));
      const settlementById = new Map(settlementSnapshots.map((snapshot) => [snapshot.id, snapshot]));
      const stockPlan = planInventoryRestock(selectedLines.map((item) => ({ productId: item.productId, quantity: selections.get(String(item.productId)) })), Object.fromEntries(productSnapshots.map((snapshot) => [snapshot.id, snapshot.data()?.stock])));

      let items = orderItems.map((item) => {
        const plan = planByProduct.get(String(item.productId));
        if (!plan) return item;
        const orderedQuantity = Number(item.orderedQuantity ?? item.quantity);
        const cancelledQuantity = Number(item.cancelledQuantity || 0) + plan.quantity;
        const ratioRemaining = plan.remainingQuantity / orderedQuantity;
        const scaled = (value) => Number((Number(value || 0) * ratioRemaining).toFixed(2));
        return {
          ...item,
          orderedQuantity,
          quantity: plan.remainingQuantity,
          cancelledQuantity,
          remainingQuantity: plan.remainingQuantity,
          itemStatus: plan.remainingQuantity === 0 ? "cancelled" : "partially_cancelled",
          mrpTotal: scaled(item.mrpTotal ?? Number(item.mrp || 0) * orderedQuantity),
          grossAmount: scaled(item.grossAmount),
          productDiscount: scaled(item.productDiscount),
          couponDiscount: scaled(item.couponDiscount),
          discount: scaled(item.discount),
          sellerSubtotal: scaled(item.originalSellerSubtotal ?? item.sellerSubtotal),
          taxableValue: scaled(item.originalTaxableValue ?? item.taxableValue),
          taxAmount: scaled(item.originalTaxAmount ?? item.taxAmount),
          gstTotal: scaled(item.originalTaxAmount ?? item.gstTotal),
          cgst: scaled(item.originalCgst ?? item.cgst),
          cgstAmount: scaled(item.originalCgst ?? item.cgstAmount),
          sgst: scaled(item.originalSgst ?? item.sgst),
          sgstAmount: scaled(item.originalSgst ?? item.sgstAmount),
          igst: scaled(item.originalIgst ?? item.igst),
          igstAmount: scaled(item.originalIgst ?? item.igstAmount),
          gstAmount: scaled(item.originalTaxAmount ?? item.gstAmount),
          commissionAmount: scaled(item.originalCommissionAmount ?? item.commissionAmount),
          vendorPayout: scaled(item.originalVendorPayout ?? item.vendorPayout),
          platformRevenue: scaled(item.originalPlatformRevenue ?? item.platformRevenue),
          shippingChargedToCustomer: Number((Number(item.shippingChargedToCustomer || 0) - plan.shippingRefundAmount).toFixed(2)),
          shippingRefundAmount: Number((Number(item.shippingRefundAmount || 0) + plan.shippingRefundAmount).toFixed(2)),
          customerLineTotal: scaled(item.originalCustomerLineTotal ?? item.customerLineTotal),
          refundRequestedAmount: Number((Number(item.refundRequestedAmount || 0) + (paidOrder ? plan.refundAmount : 0)).toFixed(2)),
        };
      });
      const sellerGroups = new Map();
      items.forEach((item, index) => {
        const sellerKey = `${item.sellerType || "partswala"}:${item.sellerId || "partswala"}`;
        const group = sellerGroups.get(sellerKey) || [];
        group.push({ item, index });
        sellerGroups.set(sellerKey, group);
      });
      for (const [sellerKey, sellerLines] of sellerGroups) {
        if (sellerHasRemaining.get(sellerKey) === 0) continue;
        const sellerShippingTotal = sellerLines.reduce((sum, { item }) => sum + Number(item.originalShippingChargedToCustomer ?? item.shippingChargedToCustomer ?? 0), 0);
        const activeLines = sellerLines.filter(({ item }) => Number(item.remainingQuantity ?? item.quantity) > 0);
        const allocations = allocateMoney(sellerShippingTotal, activeLines.map(({ item }) => ({ ...item, customerLineTotal: Number(item.originalTaxableValue ?? item.taxableValue ?? item.sellerSubtotal ?? 0) })), "customerLineTotal");
        activeLines.forEach(({ item, index }, allocationIndex) => {
          const orderedQuantity = Number(item.orderedQuantity ?? item.quantity);
          const remainingQuantity = Number(item.remainingQuantity ?? item.quantity);
          const ratio = orderedQuantity > 0 ? remainingQuantity / orderedQuantity : 0;
          const originalLineTotal = Number(item.originalCustomerLineTotal ?? item.customerLineTotal ?? 0);
          const originalShipping = Number(item.originalShippingChargedToCustomer ?? item.shippingChargedToCustomer ?? 0);
          const activeNonShipping = Number(((originalLineTotal - originalShipping) * ratio).toFixed(2));
          activeLines[allocationIndex].item = {
            ...item,
            shippingChargedToCustomer: allocations[allocationIndex],
            customerLineTotal: Number((activeNonShipping + allocations[allocationIndex]).toFixed(2)),
          };
          items[index] = activeLines[allocationIndex].item;
        });
      }
      const activeItems = items.filter((item) => Number(item.remainingQuantity ?? item.quantity) > 0);
      const allCancelled = activeItems.length === 0;
      const nextStatus = allCancelled ? "cancelled" : "partially_cancelled";
      const activeTotals = {
        subtotal: Number(activeItems.reduce((sum, item) => sum + Number(item.unitPrice || item.price || 0) * Number(item.quantity || 0), 0).toFixed(2)),
        discount: Number(activeItems.reduce((sum, item) => sum + Number(item.discount || 0), 0).toFixed(2)),
        taxableAmount: Number(activeItems.reduce((sum, item) => sum + Number(item.taxableValue || 0) + Number(item.shippingTaxableValue || 0) + Number(item.codFeeTaxableValue || 0), 0).toFixed(2)),
        cgst: Number(activeItems.reduce((sum, item) => sum + Number(item.cgst || 0), 0).toFixed(2)),
        sgst: Number(activeItems.reduce((sum, item) => sum + Number(item.sgst || 0), 0).toFixed(2)),
        igst: Number(activeItems.reduce((sum, item) => sum + Number(item.igst || 0), 0).toFixed(2)),
        gstTotal: Number(activeItems.reduce((sum, item) => sum + Number(item.gstTotal || item.taxAmount || 0), 0).toFixed(2)),
        shipping: Number(activeItems.reduce((sum, item) => sum + Number(item.shippingChargedToCustomer || 0), 0).toFixed(2)),
        codFee: Number(activeItems.reduce((sum, item) => sum + Number(item.codFee || 0), 0).toFixed(2)),
        grandTotal: Number(activeItems.reduce((sum, item) => sum + Number(item.customerLineTotal || 0), 0).toFixed(2)),
      };
      const sellerSuborders = groupSellerSuborders(items).map((suborder, index) => ({
        ...suborder,
        id: `${orderRef.id}_seller_${index}`,
        orderId: orderRef.id,
        orderStatus: sellerHasRemaining.get(`${suborder.sellerType}:${suborder.sellerId}`) === 0 ? "cancelled" : nextStatus,
        status: sellerHasRemaining.get(`${suborder.sellerType}:${suborder.sellerId}`) === 0 ? "cancelled" : "active",
        shippingRefundAmount: Number(items.filter((item) => item.sellerId === suborder.sellerId && item.sellerType === suborder.sellerType).reduce((sum, item) => sum + Number(item.shippingRefundAmount || 0), 0).toFixed(2)),
      }));
      const refundRequestId = `cancel_${cancellationKey}`;
      const refundRef = db.collection("refundRequests").doc(cancellationKey);
      const paidOrder = order.paymentStatus === "Paid" || order.paymentStatus === "COD collected";
      stockPlan.forEach(({ productId, stock }) => transaction.update(db.collection("products").doc(productId), { stock, updatedAt: timestamp }));
      for (const item of selectedLines) {
        if (!item.settlementId) continue;
        const settlementSnapshot = settlementById.get(item.settlementId);
        if (!settlementSnapshot?.exists) continue;
        const plan = planByProduct.get(String(item.productId));
        if (settlementSnapshot.data()?.settlementStatus === "paid") {
          const adjustmentRef = db.collection("financeAdjustments").doc(`${cancellationKey}_${createHash("sha256").update(item.settlementId).digest("hex").slice(0, 12)}`);
          const oldPayout = Number(settlementSnapshot.data()?.vendorPayout || 0);
          const newPayout = Math.max(0, Number((oldPayout - plan.vendorPayoutReversal).toFixed(2)));
          transaction.create(adjustmentRef, { adjustmentId: adjustmentRef.id, originalTransaction: item.settlementId, orderId, oldAmount: oldPayout, adjustmentAmount: Number((newPayout - oldPayout).toFixed(2)), newNetAmount: newPayout, reason: "Customer item cancellation", adminId: "system", timestamp });
        } else {
          transaction.update(settlementSnapshot.ref, {
            sellerSubtotal: Math.max(0, Number((Number(settlementSnapshot.data()?.sellerSubtotal || 0) - plan.taxableValueReversal).toFixed(2))),
            commissionAmount: Math.max(0, Number((Number(settlementSnapshot.data()?.commissionAmount || 0) - plan.commissionReversal).toFixed(2))),
            vendorPayout: Math.max(0, Number((Number(settlementSnapshot.data()?.vendorPayout || 0) - plan.vendorPayoutReversal).toFixed(2))),
            refundAmount: Number((Number(settlementSnapshot.data()?.refundAmount || 0) + (paidOrder ? plan.refundAmount : 0)).toFixed(2)),
            orderStatus: nextStatus,
            settlementStatus: "held",
            updatedAt: timestamp,
          });
        }
      }
      transaction.update(orderRef, {
        items,
        sellerSuborders,
        sellerFinancials: sellerSuborders,
        status: nextStatus,
        orderStatus: nextStatus,
        ...activeTotals,
        total: activeTotals.grandTotal,
        totalAmount: activeTotals.grandTotal,
        shipping: activeTotals.shipping,
        shippingCharge: activeTotals.shipping,
        shippingChargedToCustomer: activeTotals.shipping,
        refundStatus: paidOrder && canceledTotal > 0 ? "refund_requested" : order.refundStatus || "none",
        cancelledAmount: Number((Number(order.cancelledAmount || 0) + canceledTotal).toFixed(2)),
        refundRequestedAmount: Number((Number(order.refundRequestedAmount || 0) + (paidOrder ? canceledTotal : 0)).toFixed(2)),
        ...(allCancelled ? { cancelledAt: timestamp, inventoryReservationStatus: "released" } : {}),
        updatedAt: timestamp,
        timeline: [...(order.timeline || []), { status: nextStatus, label: "Items cancelled", timestamp, note: `${cancellationPlans.length} selected line(s) were cancelled.` }],
      });
      transaction.create(cancellationRef, { orderId, userId: user.uid, requestId, items: cancellationPlans, amount: canceledTotal, refundRequestId: paidOrder ? refundRequestId : null, status: paidOrder ? "refund_requested" : "cancelled", createdAt: timestamp });
      if (paidOrder && canceledTotal > 0) {
        const pendingQuantities = { ...(order.refundPendingQuantities || {}) };
        const refundItems = cancellationPlans.map((plan) => {
          const item = selectedLines.find((line) => String(line.productId) === plan.productId);
          pendingQuantities[item.productId] = Number(pendingQuantities[item.productId] || 0) + plan.quantity;
          return { ...plan, sellerId: item.sellerId || "partswala", sellerType: item.sellerType || "partswala", settlementId: item.settlementId || null, lineRefundAmount: plan.refundAmount, taxAmount: plan.gstReversal, commissionAmount: plan.commissionReversal, vendorPayout: plan.vendorPayoutReversal };
        });
        transaction.create(refundRef, { refundRequestId, orderId, userId: user.uid, provider: order.paymentGateway || "manual_cod", paymentId: order.paymentId, amount: canceledTotal, items: refundItems, status: "refund_requested", createdAt: timestamp, updatedAt: timestamp });
        transaction.update(orderRef, { refundPendingAmount: Number((Number(order.refundPendingAmount || 0) + canceledTotal).toFixed(2)), refundPendingQuantities: pendingQuantities });
      }
      const creditNoteGroups = new Map();
      cancellationPlans.forEach((plan) => {
        const item = selectedLines.find((line) => String(line.productId) === plan.productId);
        const sellerKey = `${item.sellerType || "partswala"}:${item.sellerId || "partswala"}`;
        const group = creditNoteGroups.get(sellerKey) || { item, plans: [] };
        group.plans.push(plan);
        creditNoteGroups.set(sellerKey, group);
      });
      for (const [sellerKey, group] of creditNoteGroups) {
        const noteId = `${cancellationKey}_${createHash("sha256").update(sellerKey).digest("hex").slice(0, 12)}`;
        const creditNoteRef = db.collection("creditNotes").doc(noteId);
        const creditLines = group.plans.map((plan) => {
          const item = selectedLines.find((line) => String(line.productId) === plan.productId);
          return { productId: item.productId, name: item.name, quantity: plan.quantity, unitPrice: item.unitPrice, discount: plan.discountReversal, taxableAmount: plan.taxableValueReversal, gst: plan.gstReversal, refundAmount: plan.refundAmount };
        });
        transaction.create(creditNoteRef, {
          creditNoteId: noteId,
          originalInvoiceId: group.item.sellerInvoiceNumber || order.invoiceNumber,
          orderId,
          sellerId: group.item.sellerId || "partswala",
          sellerType: group.item.sellerType || "partswala",
          reason: "Customer item cancellation",
          items: creditLines,
          taxableAmount: Number(group.plans.reduce((sum, plan) => sum + plan.taxableValueReversal, 0).toFixed(2)),
          gst: Number(group.plans.reduce((sum, plan) => sum + plan.gstReversal, 0).toFixed(2)),
          refundAmount: paidOrder ? Number(group.plans.reduce((sum, plan) => sum + plan.refundAmount, 0).toFixed(2)) : 0,
          createdAt: timestamp,
          status: paidOrder ? "refund_requested" : "cancelled_unpaid",
          accountingReview: "CA_REVIEW_REQUIRED",
          ...(paidOrder ? { refundRequestId } : {}),
        });
      }
      return { duplicate: false, status: nextStatus, cancelledAmount: canceledTotal, refundStatus: paidOrder ? "refund_requested" : "not_applicable", refundRequestId: paidOrder ? refundRequestId : null, cancellationKey, provider: order.paymentGateway || "manual_cod" };
    });
    if (result.refundStatus === "refund_requested" && result.refundRequestId && result.provider !== "manual_cod") {
      await submitProviderRefund(db, db.collection("refundRequests").doc(result.cancellationKey));
    }
    return response.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const conflicts = ["CANCELLATION_SHIPMENT_STARTED", "PAYMENT_NOT_CONFIRMED", "CANCELLATION_ITEM_RETURNED", "CANCELLATION_ITEM_REFUNDED", "CANCELLATION_ITEM_ALREADY_CANCELLED"];
    const status = error.message === "ORDER_NOT_FOUND" ? 404 : conflicts.includes(error.message) ? 409 : error.message === "CANCELLATION_PRODUCT_NOT_FOUND" ? 404 : 400;
    return response.status(status).json({ message: error.message || "Selected items could not be cancelled." });
  }
});

app.post("/api/orders/cancel", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  const orderId = String(request.body?.orderId || "");
  if (!orderId) return response.status(400).json({ message: "orderId is required" });
  try {
    const db = getDb();
    const orderRef = db.collection("orders").doc(orderId);
    await db.runTransaction(async (transaction) => {
      const orderSnapshot = await transaction.get(orderRef);
      if (!orderSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
      const order = orderSnapshot.data();
      if (order.userId !== user.uid) throw new Error("ORDER_ACCESS_DENIED");
      if (order.status === "cancelled") return;
      if (order.paymentStatus === "Paid" || order.paymentStatus === "COD collected") throw new Error("PAID_ORDER_CANNOT_BE_CANCELLED");
      if (!["pending", "confirmed", "processing"].includes(String(order.status || order.orderStatus).toLowerCase())) throw new Error("ORDER_CANNOT_BE_CANCELLED");
      const timestamp = new Date().toISOString();
      const inventoryReleased = await releaseInventoryReservation(transaction, db, order, timestamp);
      const items = (order.items || []).map((item) => item.sellerType === "vendor"
        ? { ...item, sellerSubtotal: 0, commissionAmount: 0, vendorPayout: 0, platformRevenue: 0, settlementStatus: "held" }
        : item);
      for (const item of items) {
        if (item.settlementId) transaction.update(db.collection("vendorSettlements").doc(item.settlementId), { sellerSubtotal: 0, commissionAmount: 0, vendorPayout: 0, orderStatus: "cancelled", settlementStatus: "held", updatedAt: timestamp });
      }
      transaction.update(orderRef, { items, sellerSuborders: groupSellerSuborders(items).map((row, index) => ({ ...row, id: `${orderRef.id}_seller_${index}`, orderId: orderRef.id })), status: "cancelled", orderStatus: "cancelled", paymentStatus: "Cancelled", ...(inventoryReleased ? { inventoryReservationStatus: "released", inventoryReleasedAt: timestamp } : {}), cancelledAt: timestamp, updatedAt: timestamp });
    });
    return response.json({ ok: true });
  } catch (error) {
    const status = error.message === "ORDER_NOT_FOUND" ? 404 : error.message === "ORDER_ACCESS_DENIED" ? 403 : ["PAID_ORDER_CANNOT_BE_CANCELLED", "ORDER_CANNOT_BE_CANCELLED"].includes(error.message) ? 409 : 500;
    return response.status(status).json({ message: error.message || "Order could not be cancelled." });
  }
});

app.post("/api/phonepe/orders", async (request, response) => {
  const user = await authenticatedUser(request, response);
  if (!user) return;
  try {
    requireEnv(["PHONEPE_CHECKOUT_ENDPOINT"]);
    const orderId = String(request.body?.orderId || "");
    if (!orderId) return response.status(400).json({ message: "orderId is required" });
    const db = getDb();
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) return response.status(404).json({ message: "Order not found" });
    const order = orderSnapshot.data();
    if (order.userId !== user.uid) return response.status(403).json({ message: "Order access denied" });
    if (order.paymentMethod !== "PhonePe" || order.status === "cancelled" || order.paymentStatus === "Paid" || order.inventoryReservationStatus === "released") {
      return response.status(409).json({ message: "This order is not available for PhonePe payment." });
    }
    const phonePeResponse = await fetch(process.env.PHONEPE_CHECKOUT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Number(order.grandTotal),
        customer: order.customer,
        items: order.items,
        userId: order.userId,
        orderId,
      }),
    });
    const result = await phonePeResponse.json().catch(() => ({}));
    if (!phonePeResponse.ok || !result.redirectUrl) {
      return response.status(502).json({ message: result.message || "PhonePe checkout could not be started." });
    }
    return response.json(result);
  } catch (error) {
    console.error("PhonePe checkout failed:", error);
    return response.status(500).json({ message: error.message || "PhonePe checkout could not be started." });
  }
});

app.post("/api/razorpay/orders", async (request, response) => {
  try {
    const user = await authenticatedUser(request, response);
    if (!user) return;
    requireEnv(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    const orderId = String(request.body?.orderId || "");
    if (!orderId) return response.status(400).json({ message: "orderId is required" });
    const db = getDb();
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) return response.status(404).json({ message: "Order not found" });
    const order = orderSnapshot.data();
    if (order.userId !== user.uid) return response.status(403).json({ message: "Order access denied" });
    if (order.status === "cancelled" || order.paymentStatus === "Paid" || order.inventoryReservationStatus === "released") return response.status(409).json({ message: "This order can no longer be paid." });
    if (order.paymentMethod === "COD") return response.status(400).json({ message: "Cash on Delivery orders do not need online payment." });
    const amount = Number(order.grandTotal);
    if (!Number.isFinite(amount) || amount <= 0) return response.status(400).json({ message: "The saved order total is invalid." });
    if (order.paymentDetails?.razorpayOrderId) {
      return response.json({ id: order.paymentDetails.razorpayOrderId, amount: Math.round(amount * 100), currency: "INR", key_id: process.env.RAZORPAY_KEY_ID });
    }
    const credentials = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
    const razorpayResponse = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${credentials}` },
      body: JSON.stringify({ amount: Math.round(amount * 100), currency: "INR", receipt: `pw_${Date.now()}` }),
    });
    const result = await razorpayResponse.json();
    if (!razorpayResponse.ok) return response.status(razorpayResponse.status).json({ message: result.error?.description || "Razorpay order could not be created." });
    await orderRef.update({ "paymentDetails.razorpayOrderId": result.id, updatedAt: new Date().toISOString() });
    return response.status(razorpayResponse.status).json({ ...result, key_id: process.env.RAZORPAY_KEY_ID });
  } catch (error) {
    return response.status(500).json({ message: error.message });
  }
});

app.post("/api/razorpay/verify", async (request, response) => {
  try {
    const user = await authenticatedUser(request, response);
    if (!user) return;
    requireEnv(["RAZORPAY_KEY_SECRET"]);
    const { orderId: internalOrderId, payment } = request.body || {};
    const { razorpay_order_id: paymentOrderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = payment || {};
    if (!internalOrderId || !paymentOrderId || !paymentId || !signature) return response.status(400).json({ message: "Incomplete Razorpay response" });
    const db = getDb();
    const orderRef = db.collection("orders").doc(String(internalOrderId));
    const orderSnapshot = await orderRef.get();
    if (!orderSnapshot.exists) return response.status(404).json({ message: "Order not found" });
    const order = orderSnapshot.data();
    if (order.userId !== user.uid) return response.status(403).json({ message: "Order access denied" });
    if (order.paymentDetails?.razorpayOrderId !== paymentOrderId) return response.status(400).json({ message: "Payment does not match this saved order." });
    const expected = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${paymentOrderId}|${paymentId}`).digest("hex");
    const valid = expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (valid) {
      const verifiedAt = new Date().toISOString();
      const result = await db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(orderRef);
        if (!currentSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
        const currentOrder = currentSnapshot.data();
        if (currentOrder.userId !== user.uid) throw new Error("ORDER_ACCESS_DENIED");
        if (currentOrder.paymentDetails?.razorpayOrderId !== paymentOrderId) throw new Error("PAYMENT_ORDER_MISMATCH");
        if (currentOrder.paymentStatus === "Paid" && currentOrder.paymentId === paymentId) return { duplicate: true };
        if (currentOrder.paymentStatus === "Paid" || currentOrder.status === "cancelled" || currentOrder.inventoryReservationStatus === "released") throw new Error("ORDER_NOT_PAYABLE");
        const settlementRefs = (currentOrder.items || []).filter((item) => item.settlementId).map((item) => db.collection("vendorSettlements").doc(item.settlementId));
        const settlementSnapshots = await Promise.all(settlementRefs.map((reference) => transaction.get(reference)));
        transaction.update(orderRef, {
          paymentStatus: "Paid",
          paymentCollectedAmount: Number(currentOrder.grandTotal || 0),
          paymentId,
          status: "confirmed",
          orderStatus: "confirmed",
          inventoryReservationStatus: "committed",
          "paymentDetails.razorpayPaymentId": paymentId,
          "paymentDetails.razorpaySignature": signature,
          "paymentDetails.verifiedAt": verifiedAt,
          updatedAt: verifiedAt,
        });
        settlementSnapshots.forEach((snapshot) => {
          if (snapshot.exists) transaction.update(snapshot.ref, { paymentStatus: "Paid", orderStatus: "confirmed", updatedAt: verifiedAt });
        });
        return { duplicate: false };
      });
      return response.json({ valid: true, duplicate: result.duplicate });
    }
    return response.status(400).json({ valid: false });
  } catch (error) {
    return response.status(500).json({ message: error.message });
  }
});

app.post("/api/phonepe/webhook", async (request, response) => {
  try {
    requireEnv(["PHONEPE_WEBHOOK_SECRET"]);
    const suppliedSecret = Buffer.from(String(request.headers["x-api-key"] || ""));
    const expectedSecret = Buffer.from(process.env.PHONEPE_WEBHOOK_SECRET);
    if (suppliedSecret.length !== expectedSecret.length || !timingSafeEqual(suppliedSecret, expectedSecret)) return response.status(401).json({ message: "Invalid payment webhook secret." });
    if (request.body?.refundRequestId || String(request.body?.eventType || "").toLowerCase().includes("refund")) {
      const refundRequestId = String(request.body?.refundRequestId || request.body?.merchantRefundId || "");
      const refundStatus = String(request.body?.refundStatus || request.body?.status || "");
      const eventId = webhookEventId("phonepe-refund", request.headers["x-event-id"], request.body || {});
      if (!refundRequestId || !eventId) return response.status(400).json({ message: "Refund request and stable event IDs are required." });
      const db = getDb();
      const refundSnapshot = await db.collection("refundRequests").where("refundRequestId", "==", refundRequestId).limit(1).get();
      if (refundSnapshot.empty) return response.status(404).json({ message: "Refund request was not found." });
      const result = await finalizeProviderRefund(db, refundSnapshot.docs[0].ref, db.collection("webhookEvents").doc(eventId), refundStatus, String(request.body?.providerRefundId || request.body?.refundId || ""));
      return response.json({ ok: true, ...result });
    }
    const orderId = String(request.body?.orderId || request.body?.merchantOrderId || "");
    const status = String(request.body?.status || "").toLowerCase();
    const paymentId = String(request.body?.paymentId || request.body?.transactionId || "");
    if (!orderId || !status) return response.status(400).json({ message: "Order ID and payment status are required." });
    const isPaid = ["paid", "success", "completed", "payment_success"].includes(status);
    const isFailed = ["failed", "failure", "payment_failed"].includes(status);
    if (!isPaid && !isFailed) return response.status(200).json({ ok: true, ignored: true });
    const db = getDb();
    const orderRef = db.collection("orders").doc(orderId);
    const eventId = webhookEventId("phonepe", request.headers["x-event-id"], request.body || {});
    if (!eventId) return response.status(400).json({ message: "A stable PhonePe event ID is required." });
    const result = await db.runTransaction(async (transaction) => {
      const [orderSnapshot, eventSnapshot] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(db.collection("webhookEvents").doc(eventId)),
      ]);
      if (!orderSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
      if (eventSnapshot.exists) return { duplicate: true };
      const order = orderSnapshot.data();
      if (order.paymentMethod !== "PhonePe") throw new Error("PAYMENT_METHOD_MISMATCH");
      if (order.status === "cancelled") throw new Error("ORDER_CANCELLED");
      if (order.paymentStatus === "Paid") return { duplicate: true };
      const settlementRefs = (order.items || []).filter((item) => item.settlementId).map((item) => db.collection("vendorSettlements").doc(item.settlementId));
      const settlementSnapshots = await Promise.all(settlementRefs.map((reference) => transaction.get(reference)));
      const paymentStatus = isPaid ? "Paid" : "Failed";
      const timestamp = new Date().toISOString();
      const inventoryReleased = isFailed ? await releaseInventoryReservation(transaction, db, order, timestamp) : false;
      const lateCapture = isPaid && order.inventoryReservationStatus === "released";
      transaction.create(db.collection("webhookEvents").doc(eventId), { provider: "phonepe", orderId, paymentStatus, receivedAt: timestamp });
      transaction.update(orderRef, { paymentStatus, ...(isPaid ? { paymentCollectedAmount: Number(order.grandTotal || 0) } : {}), status: isPaid ? lateCapture ? "payment_review" : "confirmed" : "payment_failed", orderStatus: isPaid ? lateCapture ? "payment_review" : "confirmed" : "payment_failed", ...(isPaid && !lateCapture ? { inventoryReservationStatus: "committed" } : inventoryReleased ? { inventoryReservationStatus: "released", inventoryReleasedAt: timestamp } : {}), ...(lateCapture ? { paymentReconciliationStatus: "late_capture_after_reservation_release" } : {}), paymentId: paymentId || order.paymentId || null, "paymentDetails.phonePePaymentId": paymentId || null, updatedAt: timestamp });
      settlementSnapshots.forEach((snapshot) => {
        if (snapshot.exists) transaction.update(snapshot.ref, { paymentStatus, orderStatus: isPaid ? lateCapture ? "payment_review" : "confirmed" : "payment_failed", updatedAt: timestamp });
      });
      return { duplicate: false, lateCapture };
    });
    return response.json({ ok: true, duplicate: result.duplicate, paymentStatus: isPaid ? "Paid" : "Failed", paymentReconciliationStatus: result.lateCapture ? "manual_review" : "reconciled" });
  } catch (error) {
    const statusCode = error.message === "ORDER_NOT_FOUND" ? 404 : error.message === "PAYMENT_METHOD_MISMATCH" ? 409 : error.message === "ORDER_CANCELLED" ? 409 : 500;
    console.error("PhonePe webhook failed:", error.message);
    return response.status(statusCode).json({ message: error.message || "Payment status could not be saved." });
  }
});

app.post("/api/razorpay/webhook", async (request, response) => {
  try {
    requireEnv(["RAZORPAY_WEBHOOK_SECRET"]);
    if (!verifyWebhookSignature(process.env.RAZORPAY_WEBHOOK_SECRET, request.headers["x-razorpay-signature"], request.rawBody)) {
      return response.status(401).json({ message: "Invalid Razorpay webhook signature." });
    }
    const event = String(request.body?.event || "");
    if (event.startsWith("refund.")) {
      const refund = request.body?.payload?.refund?.entity || {};
      const refundRequestId = String(refund.notes?.refundRequestId || "");
      const eventId = webhookEventId("razorpay-refund", request.headers["x-razorpay-event-id"], request.body || {});
      if (!refundRequestId || !eventId) return response.status(400).json({ message: "Refund request and stable event IDs are required." });
      const db = getDb();
      const refundSnapshot = await db.collection("refundRequests").where("refundRequestId", "==", refundRequestId).limit(1).get();
      if (refundSnapshot.empty) return response.status(404).json({ message: "Refund request was not found." });
      const result = await finalizeProviderRefund(db, refundSnapshot.docs[0].ref, db.collection("webhookEvents").doc(eventId), refund.status || event.slice("refund.".length), String(refund.id || ""));
      return response.json({ ok: true, ...result });
    }
    const payment = request.body?.payload?.payment?.entity || {};
    const paymentOrderId = String(payment.order_id || "");
    const paymentId = String(payment.id || "");
    const isPaid = event === "payment.captured" || event === "order.paid";
    const isFailed = event === "payment.failed";
    if ((!isPaid && !isFailed) || !paymentOrderId) return response.status(200).json({ ok: true, ignored: true });
    const eventId = webhookEventId("razorpay", request.headers["x-razorpay-event-id"], request.body || {});
    if (!eventId) return response.status(400).json({ message: "A stable Razorpay event ID is required." });
    const db = getDb();
    const orderQuery = await db.collection("orders").where("paymentDetails.razorpayOrderId", "==", paymentOrderId).limit(1).get();
    if (orderQuery.empty) return response.status(404).json({ message: "Order for this Razorpay payment was not found." });
    const orderRef = orderQuery.docs[0].ref;
    const result = await db.runTransaction(async (transaction) => {
      const eventRef = db.collection("webhookEvents").doc(eventId);
      const [orderSnapshot, eventSnapshot] = await Promise.all([transaction.get(orderRef), transaction.get(eventRef)]);
      if (!orderSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
      if (eventSnapshot.exists) return { duplicate: true };
      const order = orderSnapshot.data();
      if (order.paymentMethod !== "Online" || order.paymentGateway !== "razorpay") throw new Error("PAYMENT_METHOD_MISMATCH");
      if (order.paymentStatus === "Paid") {
        transaction.create(eventRef, { provider: "razorpay", orderId: orderRef.id, event, paymentId, receivedAt: new Date().toISOString() });
        return { duplicate: true };
      }
      const timestamp = new Date().toISOString();
      const settlementRefs = (order.items || []).filter((item) => item.settlementId).map((item) => db.collection("vendorSettlements").doc(item.settlementId));
      const settlementSnapshots = await Promise.all(settlementRefs.map((reference) => transaction.get(reference)));
      const inventoryReleased = isFailed ? await releaseInventoryReservation(transaction, db, order, timestamp) : false;
      const lateCapture = isPaid && order.inventoryReservationStatus === "released";
      transaction.create(eventRef, { provider: "razorpay", orderId: orderRef.id, event, paymentId, receivedAt: timestamp });
      transaction.update(orderRef, {
        paymentStatus: isPaid ? "Paid" : "Failed",
        ...(isPaid ? { paymentCollectedAmount: Number(order.grandTotal || 0) } : {}),
        paymentId: paymentId || order.paymentId || null,
        status: isPaid ? lateCapture ? "payment_review" : "confirmed" : "payment_failed",
        orderStatus: isPaid ? lateCapture ? "payment_review" : "confirmed" : "payment_failed",
        ...(isPaid && !lateCapture ? { inventoryReservationStatus: "committed" } : {}),
        ...(inventoryReleased ? { inventoryReservationStatus: "released", inventoryReleasedAt: timestamp } : {}),
        ...(lateCapture ? { paymentReconciliationStatus: "late_capture_after_reservation_release" } : {}),
        "paymentDetails.razorpayPaymentId": paymentId || null,
        updatedAt: timestamp,
      });
      settlementSnapshots.forEach((snapshot) => {
        if (snapshot.exists) transaction.update(snapshot.ref, { paymentStatus: isPaid ? "Paid" : "Failed", orderStatus: isPaid ? lateCapture ? "payment_review" : "confirmed" : "payment_failed", updatedAt: timestamp });
      });
      return { duplicate: false, lateCapture };
    });
    return response.json({ ok: true, duplicate: result.duplicate, paymentReconciliationStatus: result.lateCapture ? "manual_review" : "reconciled" });
  } catch (error) {
    const statusCode = error.message === "ORDER_NOT_FOUND" ? 404 : error.message === "PAYMENT_METHOD_MISMATCH" ? 409 : 500;
    console.error("Razorpay webhook failed:", error.message);
    return response.status(statusCode).json({ message: error.message || "Razorpay payment status could not be saved." });
  }
});

app.post("/api/shiprocket/orders", async (request, response) => {
  let orderRef;
  let orderLoaded = false;
  let db;
  let assignedAwb = false;
  try {
    const { orderId } = request.body || {};
    if (!orderId) return response.status(400).json({ message: "orderId is required" });
    const user = await authenticatedUser(request, response);
    if (!user) return;
    db = getDb();
    orderRef = db.collection("orders").doc(String(orderId));
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return response.status(404).json({ message: "Order not found" });
    orderLoaded = true;

    // Firestore is the source of truth: ownership, payment state, and lifecycle state are all
    // re-checked here before any Shiprocket API call. Client supplied payment data is ignored.
    const authorization = shipmentAuthorizationProblem({ order, actor: { uid: user.uid, isAdmin: isAdminUser(user) } });
    if (!authorization.ok) {
      if (authorization.code === "SHIPMENT_IN_PROGRESS") return response.status(202).json({ ok: true, message: authorization.message });
      return response.status(authorization.status).json({ code: authorization.code, message: authorization.message });
    }
    if (authorization.duplicate) {
      return response.json({ ok: true, duplicate: true, shippingStatus: order.shippingStatus || "confirmed", tracking: order.tracking || {}, shipments: order.shippingShipments || [] });
    }

    if (Array.isArray(order.sellerSuborders) && order.sellerSuborders.length > 1) {
      const attemptId = randomUUID();
      const lock = await db.runTransaction(async (transaction) => {
        const latestSnapshot = await transaction.get(orderRef);
        const latest = latestSnapshot.data();
        const latestAuthorization = shipmentAuthorizationProblem({ order: latest, actor: { uid: user.uid, isAdmin: isAdminUser(user) } });
        if (!latestAuthorization.ok) return { authorization: latestAuthorization, latest };
        if (latestAuthorization.duplicate) return { duplicate: true, latest };
        const attemptedAt = Date.parse(latest.shippingAttemptAt || "") || 0;
        if (latest.shippingStatus === "processing" && Date.now() - attemptedAt < 120000) return { busy: true, latest };
        transaction.update(orderRef, { shippingStatus: "processing", shippingAttemptId: attemptId, shippingAttemptAt: new Date().toISOString(), shippingError: null, updatedAt: new Date().toISOString() });
        return { busy: false, latest };
      });
      if (lock.authorization) {
        if (lock.authorization.code === "SHIPMENT_IN_PROGRESS") return response.status(202).json({ ok: true, message: lock.authorization.message });
        return response.status(lock.authorization.status).json({ code: lock.authorization.code, message: lock.authorization.message });
      }
      if (lock.duplicate) return response.json({ ok: true, duplicate: true, shippingStatus: lock.latest.shippingStatus || "confirmed", tracking: lock.latest.tracking || {}, shipments: lock.latest.shippingShipments || [] });
      if (lock.busy) return response.status(202).json({ ok: true, message: "Seller shipments are already being created." });
      // Retries must never create a second Shiprocket order (and therefore a second AWB) for a
      // seller that already has one, so only the missing seller shipments are submitted.
      const { shipments: recordedShipments, pending } = pendingSellerShipments(lock.latest.sellerSuborders, lock.latest.shippingShipments);
      let shipments = recordedShipments;
      if (pending.length) {
        const token = await shiprocketToken();
        shipments = [...recordedShipments, ...await Promise.all(pending.map((sellerSuborder) => createSellerShipment(token, orderId, lock.latest, sellerSuborder)))];
      }
      const timestamp = new Date().toISOString();
      const primary = shipments[0];
      const batch = db.batch();
      batch.update(orderRef, { shippingStatus: "confirmed", shippingError: null, shippingShipments: shipments, tracking: { carrier: "Shiprocket", status: "pickup_scheduled", awb: primary.awb, trackingId: primary.awb, shipmentId: primary.shipmentId, shiprocketOrderId: primary.shiprocketOrderId, courier: primary.courier, pickupStatus: "requested" }, updatedAt: timestamp });
      shipments.forEach((shipment) => batch.set(db.collection("shiprocketOrderMap").doc(String(shipment.shiprocketOrderId)), { orderId: String(orderId), sellerId: shipment.sellerId, shipmentId: shipment.shipmentId, createdAt: timestamp }));
      await batch.commit();
      return response.json({ ok: true, shippingStatus: "confirmed", shipments });
    }

    const attemptId = randomUUID();
    const lock = await db.runTransaction(async (transaction) => {
      const latestSnap = await transaction.get(orderRef);
      const latest = latestSnap.data();
      const latestAuthorization = shipmentAuthorizationProblem({ order: latest, actor: { uid: user.uid, isAdmin: isAdminUser(user) } });
      if (!latestAuthorization.ok) return { authorization: latestAuthorization, latest };
      if (latestAuthorization.duplicate) return { duplicate: true, latest };
      const tracking = latest.tracking || {};
      const hasShiprocketOrder = Boolean(tracking.shiprocketOrderId || tracking.shipmentId || tracking.awb || tracking.trackingId || latest.shiprocketResponse?.orderId || latest.shiprocketResponse?.shipmentId);
      const attemptedAt = Date.parse(latest.shippingAttemptAt || "") || 0;
      if (latest.shippingStatus === "processing" && Date.now() - attemptedAt < 120000) return { busy: true, latest };
      transaction.update(orderRef, {
        shippingStatus: "processing",
        shippingAttemptId: attemptId,
        shippingAttemptAt: new Date().toISOString(),
        shippingError: null,
        updatedAt: new Date().toISOString(),
      });
      return { busy: false, hasShiprocketOrder, latest };
    });
    if (lock.authorization) {
      if (lock.authorization.code === "SHIPMENT_IN_PROGRESS") return response.status(202).json({ ok: true, message: lock.authorization.message });
      return response.status(lock.authorization.status).json({ code: lock.authorization.code, message: lock.authorization.message });
    }
    if (lock.duplicate) return response.json({ ok: true, duplicate: true, shippingStatus: lock.latest.shippingStatus || "confirmed", tracking: lock.latest.tracking || {}, shipments: lock.latest.shippingShipments || [] });
    if (lock.busy) return response.status(202).json({ ok: true, message: "Shipping setup is already in progress." });

    let tracking = lock.latest.tracking || {};
    assignedAwb = Boolean(tracking.awb || tracking.trackingId);
    let shiprocketOrderId = tracking.shiprocketOrderId || lock.latest.shiprocketResponse?.orderId || null;
    let shipmentId = tracking.shipmentId || lock.latest.shiprocketResponse?.shipmentId || null;
    const token = await shiprocketToken();
    if (!lock.hasShiprocketOrder) {
      const sellerPickup = lock.latest.sellerSuborders?.[0];
      const created = await shiprocketRequest(token, "/orders/create/adhoc", toShiprocketPayload(orderId, lock.latest, sellerPickup ? { name: sellerPickup.pickupName, shiprocketPickupLocationId: sellerPickup.shiprocketPickupLocationId } : null));
      const createdData = shiprocketData(created);
      shiprocketOrderId = createdData.order_id || created.order_id || createdData.id || created.id || null;
      shipmentId = createdData.shipment_id || created.shipment_id || createdData.shipmentId || created.shipmentId || null;
      if (!shiprocketOrderId || !shipmentId) {
        console.error("[SHIPROCKET] Create-order response missing required shipment identifiers.");
        throw new Error("Shiprocket did not return complete shipment details. The saved order can be retried.");
      }
      tracking = { ...tracking, carrier: "Shiprocket", shiprocketOrderId, shipmentId };
      await orderRef.update({
        tracking,
        shiprocketOrderId,
        shipmentId,
        shiprocketResponse: { orderId: shiprocketOrderId, shipmentId },
        shippingStatus: "created",
        updatedAt: new Date().toISOString(),
      });
    }

    if (!shipmentId) throw new Error("Existing Shiprocket shipment details are incomplete. Please review this order before retrying.");

    if (!tracking.awb) {
      const awbResult = await shiprocketRequest(token, "/courier/assign/awb", { shipment_id: shipmentId });
      const awbData = shipmentDetails(awbResult);
      const awb = awbData.awb_code || awbData.awb || awbResult.awb_code || awbResult.awb || null;
      if (!awb) {
        console.error("[SHIPROCKET] AWB assignment returned no airway bill.");
        throw new Error(apiErrorMessage(awbData, "A courier could not be assigned yet. Please retry shipping."));
      }
      tracking = {
        ...tracking,
        carrier: "Shiprocket",
        awb,
        trackingId: awb,
        courier: awbData.courier_name || awbData.courier || tracking.courier || null,
        shipmentId,
        shiprocketOrderId,
        status: "awb_assigned",
      };
      assignedAwb = true;
      const timestamp = new Date().toISOString();
      const latestSnap = await orderRef.get();
      await orderRef.update({
        tracking,
        shippingStatus: "awb_assigned",
        timeline: appendTimelineEvent(latestSnap.data()?.timeline, "awb_assigned", timestamp, `AWB ${awb} assigned by Shiprocket.`),
        updatedAt: timestamp,
      });
    }

    let pickupStatus = tracking.pickupStatus || null;
    let pickupResult = null;
    if (!["requested", "scheduled"].includes(pickupStatus)) {
      pickupResult = await shiprocketRequest(token, "/courier/generate/pickup", { shipment_id: [Number(shipmentId)] });
      const pickupData = shipmentDetails(pickupResult);
      const rejected = Number(pickupData.pickup_status ?? pickupResult.pickup_status) === 0 || pickupData.status === false || pickupData.status === 0;
      if (rejected) {
        console.error("[SHIPROCKET] Pickup request was rejected.");
        throw new Error(apiErrorMessage(pickupData, "Shiprocket has not accepted the pickup request. Please retry shipping."));
      }
      pickupStatus = "requested";
      const scheduledDate = pickupData.pickup_scheduled_date || pickupData.pickup_date || null;
      tracking = { ...tracking, pickupStatus, pickupScheduledAt: scheduledDate, status: "pickup_scheduled" };
      const timestamp = new Date().toISOString();
      const latestSnap = await orderRef.get();
      const updates = {
        tracking,
        shippingStatus: "confirmed",
        pickupResponse: pickupResult,
        timeline: latestSnap.data()?.timeline || [],
        updatedAt: timestamp,
      };
      updates.timeline = appendTimelineEvent(updates.timeline, "pickup_scheduled", scheduledDate || timestamp, scheduledDate ? "Pickup scheduled by Shiprocket." : "Pickup request accepted by Shiprocket.");
      await orderRef.update(updates);
    } else {
      await orderRef.update({ shippingStatus: "confirmed", updatedAt: new Date().toISOString() });
    }

    return response.json({ ok: true, shippingStatus: "confirmed", tracking, pickup: pickupResult });
  } catch (error) {
    console.error("[SHIPROCKET] Shipment request failed.", error?.code || error?.name || "shipping_error");
    if (orderRef && orderLoaded) {
      try {
        const currentSnap = await orderRef.get();
        const current = currentSnap.data() || {};
        const hasAwb = Boolean(current.tracking?.awb || current.tracking?.trackingId);
        await orderRef.update({
          shippingStatus: hasAwb ? "pickup_failed" : "shiprocket_failed",
          shippingError: hasAwb ? "AWB is assigned, but pickup was not confirmed. Retry shipping to request pickup again." : "Shipping setup failed. Retry shipping to send this saved order to Shiprocket.",
          updatedAt: new Date().toISOString(),
        });
      } catch (saveError) {
        console.error("[SHIPROCKET] Could not persist failure state.", saveError?.code || saveError?.name || "firestore_error");
      }
    }
    const message = error.message?.includes("temporarily unavailable") || /recharge your shiprocket wallet/i.test(error.message || "")
      ? error.message
      : "Your order is saved, but shipping setup did not finish. We will retry it shortly.";
    return response.status(502).json({ message, shippingStatus: assignedAwb ? "pickup_failed" : "shiprocket_failed" });
  }
});

async function handleShiprocketWebhook(request, response) {
  try {
    requireEnv(["SHIPROCKET_WEBHOOK_SECRET"]);
    const suppliedSecret = Buffer.from(String(request.headers["x-api-key"] || ""));
    const expectedSecret = Buffer.from(process.env.SHIPROCKET_WEBHOOK_SECRET);
    if (suppliedSecret.length !== expectedSecret.length || !timingSafeEqual(suppliedSecret, expectedSecret)) {
      return response.status(401).json({ message: "Invalid webhook secret" });
    }
    const payload = request.body || {};
    const orderId = payload.order_id || payload.orderId || payload.order?.order_id || payload.data?.order_id;
    const latestScan = Array.isArray(payload.scans) ? payload.scans.at(-1) : null;
    const statusValue = payload.current_status || payload.shipment_status || payload.status || latestScan?.["sr-status-label"] || latestScan?.activity;
    if (!orderId || !statusValue) return response.status(400).json({ message: "order_id and status are required" });
    const db = getDb();
    let resolvedOrderId = String(orderId);
    let orderRef = db.collection("orders").doc(resolvedOrderId);
    let shipmentMapping = null;
    let orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      const mappingIds = [...new Set([payload.sr_order_id, payload.shiprocket_order_id, orderId].filter(Boolean).map(String))];
      for (const mappingId of mappingIds) {
        const mapping = await db.collection("shiprocketOrderMap").doc(mappingId).get();
        if (mapping.exists) { shipmentMapping = mapping.data(); break; }
      }
      if (!shipmentMapping && payload.shipment_id) {
        const mappingQuery = await db.collection("shiprocketOrderMap").where("shipmentId", "==", String(payload.shipment_id)).limit(1).get();
        if (!mappingQuery.empty) shipmentMapping = mappingQuery.docs[0].data();
      }
      resolvedOrderId = shipmentMapping ? String(shipmentMapping.orderId || "") : "";
      if (!resolvedOrderId) return response.status(404).json({ message: "Order not found" });
      orderRef = db.collection("orders").doc(resolvedOrderId);
      orderSnap = await orderRef.get();
    }
    if (!orderSnap.exists) return response.status(404).json({ message: "Order not found" });
    const mapped = mapShiprocketStatus(statusValue);
    if (!mapped) return response.status(200).json({ ok: true, ignored: true });
    const eventId = webhookEventId("shiprocket", request.headers["x-event-id"], payload);
    if (!eventId) return response.status(400).json({ message: "A stable Shiprocket event ID is required." });
    const parsedTimestamp = payload.current_timestamp ? Date.parse(payload.current_timestamp) : NaN;
    const timestamp = Number.isFinite(parsedTimestamp) ? new Date(parsedTimestamp).toISOString() : new Date().toISOString();
    const result = await db.runTransaction(async (transaction) => {
      const [latestSnapshot, eventSnapshot, storeSnapshot] = await Promise.all([
        transaction.get(orderRef),
        transaction.get(db.collection("webhookEvents").doc(eventId)),
        transaction.get(db.doc("settings/store")),
      ]);
      if (eventSnapshot.exists) return { duplicate: true };
      if (!latestSnapshot.exists) throw new Error("ORDER_NOT_FOUND");
      const latest = latestSnapshot.data();
      const tracking = latest.tracking || {};
      const awb = payload.awb_code || payload.awb || tracking.awb || null;
      const eventNote = latestScan?.activity || `Shiprocket update: ${statusValue}`;
      let timeline = appendTimelineEvent(latest.timeline, mapped.event, timestamp, eventNote);
      if (payload.awb_assigned_date) timeline = appendTimelineEvent(timeline, "awb_assigned", payload.awb_assigned_date, "AWB assigned by Shiprocket.");
      if (payload.pickup_scheduled_date) timeline = appendTimelineEvent(timeline, "pickup_scheduled", payload.pickup_scheduled_date, "Pickup scheduled by Shiprocket.");
      const paymentStatus = latest.paymentStatus;
      const holdDays = Math.max(0, Number(storeSnapshot.data()?.settlementHoldDays ?? 7));
      const eligibleAt = mapped.status === "delivered" ? new Date(Date.now() + holdDays * 86400000).toISOString() : null;
      const existingShipments = latest.shippingShipments || [];
      let targetIndex = existingShipments.findIndex((shipment) => String(shipment.shiprocketOrderId) === String(orderId) || String(shipment.shipmentId) === String(payload.shipment_id || ""));
      if (targetIndex < 0 && shipmentMapping) targetIndex = existingShipments.findIndex((shipment) => shipment.sellerId === shipmentMapping.sellerId && shipment.sellerType === shipmentMapping.sellerType);
      if (targetIndex < 0 && existingShipments.length === 1) targetIndex = 0;
      const shippingShipments = existingShipments.map((shipment, index) => index === targetIndex
        ? { ...shipment, status: mapped.status, event: mapped.event, awb, courier: payload.courier_name || shipment.courier || null, ...(["rto", "rto_completed"].includes(mapped.status) ? { shippingReconciliationStatus: "pending_actual_return_cost", actualReturnShippingCost: null } : {}), updatedAt: timestamp }
        : shipment);
      const targetShipment = targetIndex >= 0 ? shippingShipments[targetIndex] : null;
      const sellerId = targetShipment?.sellerId || shipmentMapping?.sellerId || null;
      const sellerType = targetShipment?.sellerType || shipmentMapping?.sellerType || null;
      const sellerSuborders = (latest.sellerSuborders || []).map((suborder) => {
        const matchesSeller = sellerId && suborder.sellerId === sellerId && suborder.sellerType === sellerType;
        if (!matchesSeller) return suborder;
        return {
          ...suborder,
          shipmentStatus: mapped.status,
          orderStatus: mapped.status,
          ...(["rto", "rto_completed"].includes(mapped.status) ? { settlementStatus: "held", shippingReconciliationStatus: "pending_actual_return_cost", actualForwardShippingCost: suborder.actualForwardShippingCost ?? null, actualReturnShippingCost: null } : {}),
          updatedAt: timestamp,
        };
      });
      const aggregateStatus = existingShipments.length > 0 ? deriveShipmentOrderStatus(shippingShipments, latest.status || latest.orderStatus) : mapped.status;
      transaction.create(db.collection("webhookEvents").doc(eventId), { provider: "shiprocket", orderId: resolvedOrderId, status: mapped.status, receivedAt: timestamp });
      transaction.update(orderRef, {
        status: aggregateStatus,
        orderStatus: aggregateStatus,
        paymentStatus,
        ...(latest.paymentMethod === "COD" && mapped.status === "delivered" && paymentStatus !== "COD collected" ? { paymentReconciliationStatus: "pending_cod_collection" } : {}),
        ...(["rto", "rto_completed"].includes(mapped.status) ? { shippingReconciliationStatus: "pending_actual_forward_and_return_costs", actualReturnShippingCost: null } : {}),
        timeline,
        "tracking.carrier": "Shiprocket",
        "tracking.awb": awb,
        "tracking.trackingId": awb,
        "tracking.shipmentId": payload.shipment_id || tracking.shipmentId || null,
        "tracking.shiprocketOrderId": payload.sr_order_id || tracking.shiprocketOrderId || null,
        "tracking.courier": payload.courier_name || tracking.courier || null,
        "tracking.status": mapped.event,
        "tracking.latestUpdate": eventNote,
        "tracking.pickupStatus": mapped.event === "pickup_scheduled" || payload.pickup_scheduled_date ? "scheduled" : tracking.pickupStatus || null,
        "tracking.pickupScheduledAt": payload.pickup_scheduled_date || (mapped.event === "pickup_scheduled" ? timestamp : tracking.pickupScheduledAt || null),
        "tracking.estimatedDelivery": payload.etd || payload.estimated_delivery || tracking.estimatedDelivery || null,
        shippingStatus: mapped.status === "rto_completed" ? "returned_to_seller" : mapped.status === "rto" ? "rto_initiated" : mapped.status === "cancelled" ? "cancelled" : "confirmed",
        shippingShipments,
        sellerSuborders,
        updatedAt: timestamp,
      });
      for (const item of latest.items || []) {
        if (!item.settlementId || (sellerId && (item.sellerId !== sellerId || item.sellerType !== sellerType))) continue;
        transaction.update(db.collection("vendorSettlements").doc(item.settlementId), {
          orderStatus: sellerId ? mapped.status : aggregateStatus,
          paymentStatus,
          eligibleAt,
          settlementStatus: mapped.status === "cancelled" || ["rto", "rto_completed"].includes(mapped.status) ? "held" : item.settlementStatus,
          updatedAt: timestamp,
        });
      }
      return { duplicate: false };
    });
    if (result.duplicate) return response.json({ ok: true, duplicate: true, orderId: resolvedOrderId, status: mapped.status });
    return response.json({ ok: true, orderId: resolvedOrderId, status: mapped.status });
  } catch (error) {
    console.error("Shiprocket webhook error:", error);
    return response.status(500).json({ message: "Tracking update could not be saved." });
  }
}

app.post("/api/shiprocket/webhook", handleShiprocketWebhook);
app.post("/api/logistics/webhook", handleShiprocketWebhook);

function currency(value) {
  return `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function assistantReply(action, data, intent) {
  if (action === "searchProducts") return data.products.length ? `Found ${data.products.length} matching part${data.products.length === 1 ? "" : "s"}. Fitment is only confirmed when the listing says so.` : "I couldn't find a matching product in the current catalogue. Try a part number, brand, or vehicle model.";
  if (action === "checkCompatibility") return data.products.some((product) => product.compatibilityStatus === "verified") ? "These listings explicitly include the vehicle details you provided." : "I can't confirm fitment from the available product data.";
  if (action === "compareProducts") return data.products.length > 1 ? "Here is a comparison using the listed price, stock, fitment, seller, and specifications. Missing details are left unconfirmed." : "I need two products to compare. Search for parts first, or name the two products.";
  if (action === "getProduct") return data.product ? "Here are the current catalogue details for that part." : "I couldn't find that product in the catalogue.";
  if (action === "getOrders") return data.needsLogin ? "Please sign in to view your own order information." : data.orders.length ? "Here are the latest order details currently recorded for your account." : "I couldn't find matching orders on your account.";
  if (action === "getStoreInfo") return data.reply;
  if (action === "getCart") return data.items.length ? `Your cart has ${data.items.length} product${data.items.length === 1 ? "" : "s"}. The subtotal below uses current catalogue prices and excludes checkout tax and shipping.` : "Your cart is empty.";
  if (action === "getShippingEstimate") return data.available ? `Estimated shipping is ${currency(data.amount)} for ${data.actualWeight} kg actual weight. Final shipping is calculated at checkout.` : data.message || "Shipping needs to be calculated at checkout.";
  if (action === "getVendorSales") return Array.isArray(data) ? `Here are sales totals from recorded vendor settlements for ${data.length} vendor account${data.length === 1 ? "" : "s"}.` : `Your recorded product sales are ${currency(data.totalSales)}; today's recorded sales are ${currency(data.todaySales)}. Commission and payout values below are from settlement records.`;
  if (action === "getVendorPayout") return data.balances ? "Here are your backend-recorded settlement balances and recent payouts." : "Here are the current backend-recorded vendor payout totals.";
  if (action === "getLowStockProducts") return data.products.length ? `Found ${data.products.length} product${data.products.length === 1 ? "" : "s"} with stock at or below five units.` : "No low-stock products were found in the authorized catalogue.";
  if (action === "getAdminFinance") return "Here is the current finance summary. Customer collections and GST are not the same as PARTSWALA profit.";
  if (action === "addToCart") return !data.product ? "I couldn't match that request to a current catalogue product." : data.purchasable ? `${data.product.name} is ready to add to your cart.` : `${data.product.name} is not currently available to add to your cart.`;
  if (action === "removeFromCart") return data.found ? `Remove ${data.name} from your cart?` : "I couldn't match that item in your cart.";
  return intent.reply || "Tell me the truck part, vehicle model, or account task you need help with.";
}

app.post("/api/ai/chat", async (request, response) => {
  const message = String(request.body?.message || "").trim();
  if (!message || message.length > 1000) return response.status(400).json({ error: "Enter a message of 1,000 characters or fewer." });
  const authorization = request.headers.authorization || "";
  let user = null;
  if (authorization) {
    try {
      user = await verifyRequest(request);
    } catch (error) {
      return response.status(401).json({ error: error.message || "Authentication required." });
    }
  }
  const access = assistantRateLimitDecision({ user, ip: resolveClientIp(request), limiters: assistantLimiters });
  if (!access.allowed) {
    response.set("Retry-After", String(access.retryAfterSeconds));
    return response.status(429).json({ error: access.message });
  }

  let failureStage = "database";
  try {
    const db = getDb();
    const profileSnapshot = user ? await db.collection("users").doc(user.uid).get() : null;
    const profile = profileSnapshot?.exists ? profileSnapshot.data() : null;
    const actor = { user, profile, role: assistantRoleFor({ user, profile, isAdmin: isAdminUser(user || {}) }) };
    const context = request.body?.context && typeof request.body.context === "object" ? request.body.context : {};
    failureStage = "gemini";
    const intent = await interpretAssistantMessage({
      apiKey: process.env.GEMINI_API_KEY,
      model: process.env.GEMINI_MODEL,
      groqApiKey: process.env.GROQ_API_KEY,
      groqModel: process.env.GROQ_MODEL,
      message,
      history: Array.isArray(request.body?.history) ? request.body.history : [],
      context,
      role: actor.role,
    });
    if (intent.action === "clarify") return response.json({ text: intent.reply || "Which vehicle model or part do you mean?", products: [] });
    if (!canUseAssistantTool(actor.role, intent.action)) return response.status(403).json({ error: "That assistant action is not available for your account." });
    failureStage = "database";
    const data = await executeAssistantTool({ db, actor, tool: intent.action, args: intent.args, context });
    if (intent.action === "removeFromCart") {
      const item = (Array.isArray(context.cart) ? context.cart : []).find((entry) => entry.id === intent.args.productId);
      data.found = Boolean(item);
      data.name = item?.name || item?.title || "that item";
      if (data.found) data.clientAction = { type: "removeFromCart", productId: item.id };
    }
    if (intent.action === "getOrders" && actor.role === "vendor") data.isVendor = true;
    if (intent.action === "addToCart") {
      if (data.purchasable) data.clientAction = { type: "addToCart", product: data.product, quantity: data.quantity };
    }
    const result = {
      text: assistantReply(intent.action, data, intent),
      action: intent.action,
      ...data,
    };
    return response.json(result);
  } catch (error) {
    console.error("PARTSWALA AI request failed:", error?.message || error);
    const databaseFailure = failureStage === "database";
    return response.status(503).json({ error: databaseFailure ? "I'm having trouble reaching the product database right now. Please try again." : "PARTSWALA AI is unavailable right now. Please try again." });
  }
});

app.listen(port, "0.0.0.0", () => console.log(`Partswala backend listening on http://localhost:${port}`));
