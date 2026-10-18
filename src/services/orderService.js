import { db, auth } from "../firebase";
import { collection, getDocs, getDoc, doc, query, where, orderBy, onSnapshot, limit, startAfter } from "firebase/firestore";
import { fetchPublicSiteSettings } from "../../shared/publicSiteSettings.js";

const COL = "orders";

export const ORDER_STATUSES = ["pending", "confirmed", "processing", "packed", "cancelled"];

export function normalizeOrderStatus(order) {
  const status = String(order?.status || order?.orderStatus || "pending").toLowerCase().replace(/\s+/g, "_");
  return status === "processing" ? "confirmed" : status;
}

export async function placeOrder(items, checkout) {
  return backendRequest("/api/orders", {
    items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
    customer: checkout.customer,
    paymentMethod: checkout.paymentMethod,
    couponCode: checkout.couponCode || "",
    idempotencyKey: checkout.idempotencyKey,
  });
}

export function getCheckoutQuote(items, checkout) {
  return backendRequest("/api/checkout/quote", {
    items: items.map((item) => ({ productId: item.id, quantity: item.quantity })),
    customer: checkout.customer,
    paymentMethod: checkout.paymentMethod,
    couponCode: checkout.couponCode || "",
  });
}

export async function getUserOrders() {
  const user = auth.currentUser;
  if (!user) return [];
  const q = query(collection(db, COL), where("userId", "==", user.uid));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export async function getOrderById(orderId) {
  const snap = await getDoc(doc(db, COL, orderId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export function subscribeToOrder(orderId, onChange, onError) {
  return onSnapshot(doc(db, COL, orderId), (snapshot) => {
    onChange(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null);
  }, onError);
}

export async function updateOrderStatus(orderId, status) {
  return backendRequest("/api/admin/orders/status", { orderId, status });
}

export async function syncShiprocketOrder(orderId) {
  return backendRequest("/api/shiprocket/orders", { orderId });
}

export function cancelPendingOrder(orderId) {
  return backendRequest("/api/orders/cancel", { orderId });
}

export function cancelOrderItems(orderId, items, requestId = crypto.randomUUID()) {
  return backendRequest("/api/orders/cancel-items", { orderId, items, requestId });
}

export function createPhonePeCheckout(orderId) {
  return backendRequest("/api/phonepe/orders", { orderId });
}

export function subscribeToUserOrders(onChange, onError) {
  const user = auth.currentUser;
  if (!user) {
    onChange([]);
    return () => {};
  }
  const q = query(collection(db, COL), where("userId", "==", user.uid));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")));
  }, onError);
}

export function subscribeToAllOrders(onChange, onError) {
  const q = query(collection(db, COL), orderBy("createdAt", "desc"), limit(100));
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((item) => ({ id: item.id, ...item.data() })), snap.docs.at(-1) || null, snap.size === 100);
  }, onError);
}

export async function getAdminOrdersPage(cursor) {
  const constraints = [orderBy("createdAt", "desc"), limit(100)];
  if (cursor) constraints.splice(1, 0, startAfter(cursor));
  const snap = await getDocs(query(collection(db, COL), ...constraints));
  return {
    orders: snap.docs.map((item) => ({ id: item.id, ...item.data() })),
    cursor: snap.docs.at(-1) || null,
    hasMore: snap.size === 100,
  };
}

// Orders are created, updated, and cancelled only by backend Admin SDK routes; the browser has
// no direct Firestore write path to the orders collection.
export async function backendRequest(path, body, method = "POST") {
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in is required to process shipping.");
  const token = await user.getIdToken();
  const baseUrl = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(method !== "GET" ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(method !== "GET" ? { body: JSON.stringify(body || {}) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "The request could not be completed.");
  return result;
}

export function createRazorpayOrder(orderId) {
  return backendRequest("/api/razorpay/orders", { orderId });
}

export function verifyRazorpayPayment(orderId, payment) {
  return backendRequest("/api/razorpay/verify", { orderId, payment });
}

export function retryShiprocketOrder(orderId) {
  return backendRequest("/api/shiprocket/orders", { orderId });
}

export function getVendorFinance() {
  return backendRequest("/api/vendor/finance", undefined, "GET");
}

export function getVendorDashboard() {
  return backendRequest("/api/vendor/dashboard", undefined, "GET");
}

export function getVendorPickupLocation() {
  return backendRequest("/api/vendor/pickup-location", undefined, "GET");
}

export function saveVendorPickupLocation(pickupLocation) {
  return backendRequest("/api/vendor/pickup-location", pickupLocation, "PUT");
}

export function getAdminPickupLocations() {
  return backendRequest("/api/admin/pickup-locations", undefined, "GET");
}

export function setAdminPickupLocationStatus(vendorId, isActive) {
  return backendRequest("/api/admin/pickup-locations", { vendorId, isActive }, "PATCH");
}

export function createOrderReturnRequest(payload) {
  return backendRequest("/api/orders/returns", payload);
}

export function reviewOrderReturn(payload) {
  return backendRequest("/api/admin/returns", payload, "PATCH");
}

export function getAdminFinance(startDate, endDate) {
  const query = new URLSearchParams({ startDate, endDate });
  return backendRequest(`/api/admin/finance?${query.toString()}`, undefined, "GET");
}

export function getAdminFinanceDetails(startDate, endDate, ordersCursor, settlementsCursor) {
  const query = new URLSearchParams({ startDate, endDate });
  if (ordersCursor) query.set("ordersCursor", ordersCursor);
  if (settlementsCursor) query.set("settlementsCursor", settlementsCursor);
  return backendRequest(`/api/admin/finance/details?${query.toString()}`, undefined, "GET");
}

export function reviewAdminInvoice(orderId, invoiceNumber, reason) {
  return backendRequest("/api/admin/invoices/review", { orderId, invoiceNumber, reason });
}

export function updateAdminOrderFinance(orderId, details) {
  return backendRequest("/api/admin/finance/order", {
    orderId,
    ...details,
    ...(details.action === "refund" ? { refundRequestId: details.refundRequestId || crypto.randomUUID() } : {}),
  });
}

export function requestAdminRefund(orderId, items, reason, requestId = crypto.randomUUID()) {
  return backendRequest("/api/admin/refunds", { orderId, items, reason, requestId });
}

export function completeManualAdminRefund(refundId, reference) {
  return backendRequest(`/api/admin/refunds/${encodeURIComponent(refundId)}/manual-complete`, { reference }, "PATCH");
}

export function reconcileAdminCodCollection(orderId, amount, reference) {
  return backendRequest("/api/admin/orders/cod-collection", { orderId, amount, reference });
}

export function saveAdminCoupon(code, campaign, reason = "") {
  return backendRequest("/api/admin/coupons", { code, campaign, reason }, "PUT");
}

export function disableAdminCoupon(code, reason = "") {
  return backendRequest(`/api/admin/coupons/${encodeURIComponent(code)}`, { reason }, "DELETE");
}

export function saveAdminProduct(productId, product, costPrice) {
  const method = productId ? "PUT" : "POST";
  const path = productId ? `/api/admin/products/${encodeURIComponent(productId)}` : "/api/admin/products";
  return backendRequest(path, { product, costPrice }, method);
}

export function deleteAdminProduct(productId, reason = "Deleted from catalog admin") {
  return backendRequest(`/api/admin/products/${encodeURIComponent(productId)}`, { reason }, "DELETE");
}

export function setAdminProductEnabled(productId, enabled) {
  return backendRequest(`/api/admin/products/${encodeURIComponent(productId)}/enabled`, { enabled }, "PATCH");
}

export function reviewAdminVendorSubmission(submissionId, status, reason = "") {
  return backendRequest(`/api/admin/vendor-submissions/${encodeURIComponent(submissionId)}`, { status, reason }, "PATCH");
}

export function reviewAdminVendorApplication(vendorId, status, reason = "") {
  return backendRequest(`/api/admin/vendor-applications/${encodeURIComponent(vendorId)}`, { status, reason }, "PATCH");
}

export function saveAdminStoreSettings(settings, reason = "Updated store settings") {
  return backendRequest("/api/admin/settings/store", { settings, reason }, "PUT");
}

export async function getPublicSiteSettings() {
  const baseUrl = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_API_URL || "http://localhost:8787").replace(/\/$/, "");
  return fetchPublicSiteSettings(baseUrl);
}