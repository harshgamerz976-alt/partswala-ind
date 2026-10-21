const hiddenProductStatuses = new Set([
  "draft",
  "deleted",
  "disabled",
  "inactive",
  "pending",
  "pending review",
  "pending_review",
  "pending approval",
  "pending_approval",
  "rejected",
  "archived",
  "unpublished",
  "blocked",
  "submitted",
]);

function readText(value) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function isUnpublished(product) {
  return ["status", "publishStatus", "approvalStatus"].some((field) => {
    const value = product[field];
    if (value === undefined || value === null) return false;
    if (typeof value !== "string") return true;
    return hiddenProductStatuses.has(value.trim().toLowerCase());
  })
    || product.published === false
    || product.isPublished === false
    || product.deleted === true
    || product.isDeleted === true;
}

function positivePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const price = Number(value.trim());
  return Number.isFinite(price) && price > 0 ? price : null;
}

export function normalizePublicProductForEligibility(productId, product = {}) {
  const raw = product && typeof product === "object" && !Array.isArray(product) ? product : {};
  const name = readText(raw.name || raw.title);
  const price = positivePrice(raw.price);
  const legacyVendorId = readText(raw.vendorId || raw.vendorID || raw.vendor?.id);
  const sellerId = readText(raw.sellerId || legacyVendorId || raw.seller?.id);
  const sellerType = readText(raw.sellerType || raw.vendorType || raw.seller?.type || raw.vendor?.type
    || (legacyVendorId || (sellerId && sellerId.toLowerCase() !== "partswala") ? "vendor" : "partswala"));
  const enabledValue = typeof raw.enabled === "string" ? raw.enabled.trim().toLowerCase() : raw.enabled;
  const enabled = enabledValue !== false && enabledValue !== "false" && enabledValue !== "0" && enabledValue !== 0;
  const normalized = { ...raw, id: productId, name, price, sellerId, sellerType, enabled };

  if (!enabled || isUnpublished(raw) || !name || price === null
    || !["vendor", "partswala"].includes(sellerType.toLowerCase())) return null;
  return normalized;
}
