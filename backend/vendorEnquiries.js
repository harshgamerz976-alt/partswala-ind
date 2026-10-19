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

function isDisabled(value) {
  return value === false || value === 0
    || (typeof value === "string" && ["false", "0", "no"].includes(value.trim().toLowerCase()));
}

function hasIneligibleProductStatus(product) {
  return ["status", "publishStatus", "approvalStatus"].some((field) => {
    const value = product[field];
    if (value === undefined || value === null) return false;
    if (typeof value !== "string") return true;
    const status = value.trim().toLowerCase();
    return Boolean(status) && hiddenProductStatuses.has(status);
  });
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (text.length > maxLength || [...text].some((character) => {
    const code = character.codePointAt(0);
    return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
  })) return "";
  return text;
}

export function isValidSupplierDocumentId(value) {
  const id = cleanText(value, 200);
  return Boolean(id) && !id.includes("/");
}

function hasValidPositivePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value.trim())) return false;
  const price = Number(value.trim());
  return Number.isFinite(price) && price > 0;
}

export function isEligibleVendorEnquiryProduct(product, vendor) {
  if (!product || String(product.sellerType || "").trim().toLowerCase() !== "vendor"
    || typeof product.sellerId !== "string" || !product.sellerId.trim()
    || isDisabled(product.enabled) || isDisabled(product.published) || isDisabled(product.isPublished)
    || product.deleted === true || product.isDeleted === true
    || hasIneligibleProductStatus(product)
    || !String(product.name || product.title || "").trim()
    || !hasValidPositivePrice(product.price)) return false;
  return vendor?.role === "vendor" && vendor.vendorStatus === "approved";
}

export function validateSupplierEnquiryInput(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Provide a valid supplier enquiry.");
  }
  const productId = cleanText(payload.productId, 200);
  const quantity = payload.quantity;
  const message = cleanText(payload.message, 2000);
  if (!isValidSupplierDocumentId(productId)) throw new Error("Choose a valid product.");
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
    throw new Error("Enter a requested quantity between 1 and 1,000,000.");
  }
  if (!message) throw new Error("Write a message of up to 2,000 characters.");
  if (payload.shareEmail !== undefined && typeof payload.shareEmail !== "boolean") {
    throw new Error("Choose whether to share your account email with the supplier.");
  }
  return { productId, quantity, message, shareEmail: payload.shareEmail === true };
}

export function validateSupplierQuoteInput(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Provide a valid supplier quote.");
  }
  if (typeof payload.amount !== "number" && typeof payload.amount !== "string") {
    throw new Error("Enter a valid positive quote amount in INR.");
  }
  if (typeof payload.amount === "string" && !payload.amount.trim()) {
    throw new Error("Enter a valid positive quote amount in INR.");
  }
  const amount = typeof payload.amount === "number" ? payload.amount : Number(payload.amount);
  const message = cleanText(payload.message, 2000);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000000000) {
    throw new Error("Enter a valid positive quote amount in INR.");
  }
  if (!message) throw new Error("Write quote details of up to 2,000 characters.");
  return { amount: Number(amount.toFixed(2)), message };
}

export function canCreateSupplierEnquiry(profile, isAdmin) {
  if (!profile || isAdmin === true) return false;
  if (profile.role === "customer") return true;
  return profile.role === "vendor" && profile.vendorStatus === "approved";
}

export function canQuoteSupplierEnquiry(enquiry, vendorId, profile) {
  return Boolean(
    profile?.role === "vendor"
    && profile.vendorStatus === "approved"
    && enquiry?.vendorId === vendorId
    && ["new", "quoted"].includes(enquiry.status)
  );
}

export function serializeSupplierEnquiry(id, data, view) {
  const result = {
    id,
    productId: data.productId,
    productName: data.productName,
    partNumber: data.partNumber || "",
    quantity: data.quantity,
    buyerMessage: data.buyerMessage,
    status: data.status,
    quoteAmount: data.quoteAmount !== null && data.quoteAmount !== undefined && Number.isFinite(Number(data.quoteAmount))
      ? Number(data.quoteAmount)
      : null,
    quoteMessage: data.quoteMessage || "",
    createdAt: data.createdAt || "",
    updatedAt: data.updatedAt || "",
  };
  if (view === "vendor") result.buyerEmail = data.buyerEmail || null;
  else result.vendorBusinessName = data.vendorBusinessName || "";
  return result;
}
